import streamDeck, {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { launchAmpCommand, runAmpCommand } from "../amp/amp-command";
import { getErrorMessage } from "../error-message";
import { busyIndicatorFrameDurationMs } from "../rendering/busy-indicator";
import { renderCommandFeedback, renderCommandKey, type CommandFeedbackKind } from "../rendering/command-key";
import { ThreadStore } from "../state/thread-store";
import { evaluateCommandHold, getCommandKeyState } from "./command-model";
import { TemporaryFeedback } from "./temporary-feedback";

type CliCommandDefinition = {
	label: string;
	color: string;
	icon: "archive" | "review" | "ship";
	holdMs: number;
	cooldownMs?: number;
	successFeedback?: CommandFeedbackKind;
	unavailableWhileShipping?: boolean;
	requiresConnectedExecutor?: boolean;
	execute: (threadId: string) => Promise<unknown>;
	onAccepted?: (threadId: string) => void;
};

type HoldState = {
	threadId: string;
	selectionRevision: number;
	startedAt: number;
	timer: NodeJS.Timeout;
};

abstract class CliThreadCommand extends SingletonAction {
	private readonly feedback = new TemporaryFeedback<CommandFeedbackKind>();
	private readonly holds = new Map<string, HoldState>();
	private readonly inFlightActionIds = new Set<string>();
	private animationTimer: NodeJS.Timeout | undefined;
	private releaseStore: (() => void) | undefined;

	constructor(
		private readonly store: ThreadStore,
		private readonly definition: CliCommandDefinition,
	) {
		super();
		this.store.subscribe(() => {
			this.cancelInvalidatedHolds();
			logBackgroundError(this.renderVisibleActions(), `render ${this.definition.label} action`);
		});
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isKey()) return;
		this.feedback.appear(ev.action.id);
		this.releaseStore ??= this.store.acquire();
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.clearHold(ev.action.id);
		this.feedback.disappear(ev.action.id);
		if (this.feedback.visibleCount === 0) {
			this.stopAnimationTimer();
			this.releaseStore?.();
			this.releaseStore = undefined;
		}
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!ev.action.isKey()) return;
		const thread = this.store.selectedThread;
		if (!thread || !this.canStart(thread.id, this.store.selectionRevision, ev.action.id)) {
			await this.showFeedback(ev.action, "unavailable");
			return;
		}

		this.clearHold(ev.action.id);
		const hold: HoldState = {
			threadId: thread.id,
			selectionRevision: this.store.selectionRevision,
			startedAt: performance.now(),
			timer: setInterval(() => logBackgroundError(this.render(ev.action), `render ${this.definition.label} hold`), 100),
		};
		hold.timer.unref();
		this.holds.set(ev.action.id, hold);
		await this.render(ev.action);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (!ev.action.isKey()) return;
		const hold = this.holds.get(ev.action.id);
		if (!hold) return;

		const evaluation = evaluateCommandHold(
			hold,
			this.store.selectedThreadId,
			this.store.selectionRevision,
			this.definition.holdMs,
		);
		this.clearHold(ev.action.id);
		if (evaluation === "ready" && this.canStart(hold.threadId, hold.selectionRevision, ev.action.id)) {
			await this.execute(ev.action, hold.threadId, hold.selectionRevision);
		} else if (evaluation === "ready") {
			await this.showFeedback(ev.action, "unavailable");
		} else {
			await this.render(ev.action);
		}
	}

	private async execute(action: KeyDownEvent["action"], threadId: string, selectionRevision: number): Promise<void> {
		if (!this.canStart(threadId, selectionRevision, action.id) || !this.store.tryAcquireThreadAction(threadId)) {
			await this.showFeedback(action, "unavailable");
			return;
		}
		this.inFlightActionIds.add(action.id);
		this.ensureAnimationTimer();
		const appearanceGeneration = this.feedback.generation(action.id);
		let result: CommandFeedbackKind = this.definition.successFeedback ?? "success";
		let commandAccepted = false;
		try {
			await this.render(action);
			if (this.isTargetReady(threadId, selectionRevision)) {
				await this.definition.execute(threadId);
				commandAccepted = true;
				this.definition.onAccepted?.(threadId);
			} else {
				result = "unavailable";
			}
		} catch (error) {
			streamDeck.logger.warn(`${this.definition.label} command failed: ${getErrorMessage(error)}`);
			result = "error";
		} finally {
			this.inFlightActionIds.delete(action.id);
			if (this.inFlightActionIds.size === 0) this.stopAnimationTimer();
			this.store.releaseThreadAction(threadId, commandAccepted ? (this.definition.cooldownMs ?? 0) : 0);
		}
		await this.showFeedback(action, result, appearanceGeneration);
		if (result === "error" && this.feedback.isCurrent(action.id, appearanceGeneration)) {
			await action.showAlert();
		}
	}

	private isTargetReady(threadId: string, selectionRevision: number): boolean {
		const thread = this.store.snapshot.threads.find((candidate) => candidate.id === threadId);
		const unavailable = this.definition.unavailableWhileShipping && thread?.phase === "shipping";
		const missingExecutor = this.definition.requiresConnectedExecutor && !thread?.executorConnected;
		return (
			this.store.selectedThreadId === threadId &&
			this.store.selectionRevision === selectionRevision &&
			Boolean(
				thread && !thread.working && !unavailable && !missingExecutor && this.store.snapshot.connection === "live",
			)
		);
	}

	private canStart(threadId: string, selectionRevision: number, actionId: string): boolean {
		return (
			this.isTargetReady(threadId, selectionRevision) &&
			!this.inFlightActionIds.has(actionId) &&
			!this.store.isThreadActionBlocked(threadId)
		);
	}

	private async showFeedback(
		action: KeyDownEvent["action"],
		kind: CommandFeedbackKind,
		expectedGeneration = this.feedback.generation(action.id),
	): Promise<void> {
		await this.feedback.show(
			action,
			kind,
			renderCommandFeedback(kind),
			() => this.render(action),
			(error) =>
				streamDeck.logger.error(`Unable to restore ${this.definition.label} feedback: ${getErrorMessage(error)}`),
			expectedGeneration,
		);
	}

	private clearHold(actionId: string): void {
		const hold = this.holds.get(actionId);
		if (hold) clearInterval(hold.timer);
		this.holds.delete(actionId);
	}

	private cancelInvalidatedHolds(): void {
		for (const [actionId, hold] of this.holds) {
			const targetChanged =
				evaluateCommandHold(hold, this.store.selectedThreadId, this.store.selectionRevision, this.definition.holdMs) ===
				"invalidated";
			if (targetChanged || !this.canStart(hold.threadId, hold.selectionRevision, actionId)) {
				this.clearHold(actionId);
			}
		}
	}

	private async renderVisibleActions(): Promise<void> {
		await Promise.all(
			this.actions.map(async (action) => {
				if (action.isKey() && this.feedback.isVisible(action.id)) await this.render(action);
			}),
		);
	}

	private ensureAnimationTimer(): void {
		this.animationTimer ??= setInterval(() => {
			if (this.inFlightActionIds.size > 0) {
				logBackgroundError(this.renderVisibleActions(), `animate ${this.definition.label} action`);
			}
		}, busyIndicatorFrameDurationMs);
		this.animationTimer.unref();
	}

	private stopAnimationTimer(): void {
		if (this.animationTimer) clearInterval(this.animationTimer);
		this.animationTimer = undefined;
	}

	private render(action: KeyDownEvent["action"]): Promise<void> {
		const feedback = this.feedback.get(action.id);
		if (feedback) return action.setImage(renderCommandFeedback(feedback));
		const thread = this.store.selectedThread;
		const inFlight = this.inFlightActionIds.has(action.id);
		const threadInFlight = Boolean(thread && this.store.isThreadActionInFlight(thread.id));
		const blocked = Boolean(thread && this.store.isThreadActionBlocked(thread.id));
		const unavailable = this.definition.unavailableWhileShipping && thread?.phase === "shipping";
		const missingExecutor = this.definition.requiresConnectedExecutor && !thread?.executorConnected;
		const keyState = getCommandKeyState({
			connection: this.store.snapshot.connection,
			hasThread: Boolean(thread),
			working: thread?.working ?? false,
			shipping: unavailable ?? false,
			actionInFlight: inFlight,
			threadInFlight,
			blocked,
			missingExecutor: missingExecutor ?? false,
		});
		const hold = this.holds.get(action.id);
		const progress = hold ? Math.min(1, (performance.now() - hold.startedAt) / this.definition.holdMs) : 0;

		return action.setImage(
			renderCommandKey({
				label: this.definition.label,
				detail: thread?.title ?? "Select thread",
				color: this.definition.color,
				dimmed: !keyState.available,
				footer: keyState.footer,
				progress: hold ? progress : undefined,
				loading: keyState.loading,
				icon: this.definition.icon,
			}),
		);
	}
}

const reviewPrompt =
	"Review the current changes for correctness and regressions. Prioritize substantive findings, fix high-confidence issues, and report remaining risks.";
const shipPrompt =
	"Prepare and carry out the repository's configured shipping workflow for the current changes. Before changing shared state, inspect project guidance and current git state, verify relevant checks, and clearly report the intended destination. Do not force-push, rewrite history, bypass approvals, or guess when the destination or workflow is ambiguous; stop and ask instead.";

@action({ UUID: "com.daniel-insley.amp-deck.archive" })
export class ArchiveThread extends CliThreadCommand {
	constructor(store: ThreadStore) {
		super(store, {
			label: "ARCHIVE",
			color: "#D6A038",
			icon: "archive",
			holdMs: 1500,
			unavailableWhileShipping: true,
			execute: (threadId) => runAmpCommand(["--no-color", "threads", "archive", threadId]),
		});
	}
}

@action({ UUID: "com.daniel-insley.amp-deck.review-thread" })
export class ReviewThread extends CliThreadCommand {
	constructor(store: ThreadStore) {
		super(store, {
			label: "REVIEW",
			color: "#F34E3F",
			icon: "review",
			holdMs: 1000,
			cooldownMs: 10_000,
			successFeedback: "sent",
			unavailableWhileShipping: true,
			requiresConnectedExecutor: true,
			execute: (threadId) =>
				launchAmpCommand(["--no-color", "--execute", reviewPrompt, "threads", "continue", threadId], threadId),
		});
	}
}

@action({ UUID: "com.daniel-insley.amp-deck.ship" })
export class ShipThread extends CliThreadCommand {
	constructor(store: ThreadStore) {
		super(store, {
			label: "SHIP",
			color: "#F34E3F",
			icon: "ship",
			holdMs: 2000,
			successFeedback: "sent",
			unavailableWhileShipping: true,
			requiresConnectedExecutor: true,
			cooldownMs: 10_000,
			onAccepted: (threadId) => store.markShippingDispatched(threadId),
			execute: (threadId) =>
				launchAmpCommand(
					["--no-color", "--label", "shipping", "--execute", shipPrompt, "threads", "continue", threadId],
					threadId,
				),
		});
	}
}

function logBackgroundError(operation: Promise<void>, context: string): void {
	void operation.catch((error) => streamDeck.logger.error(`Unable to ${context}: ${getErrorMessage(error)}`));
}
