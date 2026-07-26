import {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { launchAmpCommand, runAmpCommand } from "../amp/amp-command";
import { renderCommandFeedback, renderCommandKey, type CommandFeedbackKind } from "../rendering/command-key";
import { ThreadStore } from "../state/thread-store";

type CliCommandDefinition = {
	label: string;
	color: string;
	icon: "archive" | "review";
	holdMs: number;
	cooldownMs?: number;
	successFeedback?: CommandFeedbackKind;
	execute: (threadId: string) => Promise<unknown>;
};

type HoldState = {
	threadId: string;
	selectionRevision: number;
	startedAt: number;
	timer: NodeJS.Timeout;
};

abstract class CliThreadCommand extends SingletonAction {
	private readonly appearanceGenerations = new Map<string, number>();
	private readonly cooldownUntil = new Map<string, number>();
	private readonly feedback = new Map<string, CommandFeedbackKind>();
	private readonly feedbackTimers = new Map<string, NodeJS.Timeout>();
	private readonly holds = new Map<string, HoldState>();
	private readonly inFlightActionIds = new Set<string>();
	private readonly inFlightThreadIds = new Set<string>();
	private readonly visibleActionIds = new Set<string>();
	private animationTimer: NodeJS.Timeout | undefined;
	private releaseStore: (() => void) | undefined;

	constructor(
		private readonly store: ThreadStore,
		private readonly definition: CliCommandDefinition,
	) {
		super();
		this.store.subscribe(() => void this.renderVisibleActions());
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isKey()) return;
		this.appearanceGenerations.set(ev.action.id, (this.appearanceGenerations.get(ev.action.id) ?? 0) + 1);
		this.visibleActionIds.add(ev.action.id);
		this.releaseStore ??= this.store.acquire();
		this.ensureAnimationTimer();
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.appearanceGenerations.set(ev.action.id, (this.appearanceGenerations.get(ev.action.id) ?? 0) + 1);
		this.clearHold(ev.action.id);
		this.feedback.delete(ev.action.id);
		const feedbackTimer = this.feedbackTimers.get(ev.action.id);
		if (feedbackTimer) clearTimeout(feedbackTimer);
		this.feedbackTimers.delete(ev.action.id);
		this.visibleActionIds.delete(ev.action.id);
		if (this.visibleActionIds.size === 0) {
			if (this.animationTimer) clearInterval(this.animationTimer);
			this.animationTimer = undefined;
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
			timer: setInterval(() => void this.render(ev.action), 100),
		};
		hold.timer.unref();
		this.holds.set(ev.action.id, hold);
		await this.render(ev.action);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (!ev.action.isKey()) return;
		const hold = this.holds.get(ev.action.id);
		if (!hold) return;

		const completed = performance.now() - hold.startedAt >= this.definition.holdMs;
		const targetUnchanged =
			this.store.selectedThreadId === hold.threadId && this.store.selectionRevision === hold.selectionRevision;
		this.clearHold(ev.action.id);
		if (completed && targetUnchanged && this.canStart(hold.threadId, hold.selectionRevision, ev.action.id)) {
			await this.execute(ev.action, hold.threadId, hold.selectionRevision);
		} else if (completed) {
			await this.showFeedback(ev.action, "unavailable");
		} else {
			await this.render(ev.action);
		}
	}

	private async execute(action: KeyDownEvent["action"], threadId: string, selectionRevision: number): Promise<void> {
		if (!this.canStart(threadId, selectionRevision, action.id)) {
			await this.showFeedback(action, "unavailable");
			return;
		}
		this.inFlightActionIds.add(action.id);
		this.inFlightThreadIds.add(threadId);
		const appearanceGeneration = this.appearanceGenerations.get(action.id);
		await this.render(action);
		if (!this.isTargetReady(threadId, selectionRevision)) {
			this.inFlightActionIds.delete(action.id);
			this.inFlightThreadIds.delete(threadId);
			await this.showFeedback(action, "unavailable");
			return;
		}
		let result: CommandFeedbackKind = this.definition.successFeedback ?? "success";
		try {
			await this.definition.execute(threadId);
			if (this.definition.cooldownMs) {
				this.cooldownUntil.set(threadId, performance.now() + this.definition.cooldownMs);
				const timer = setTimeout(() => {
					this.cooldownUntil.delete(threadId);
					void this.renderVisibleActions();
				}, this.definition.cooldownMs);
				timer.unref();
			}
		} catch {
			result = "error";
		} finally {
			this.inFlightActionIds.delete(action.id);
			this.inFlightThreadIds.delete(threadId);
			await this.showFeedback(action, result, appearanceGeneration);
		}
	}

	private isTargetReady(threadId: string, selectionRevision: number): boolean {
		const thread = this.store.snapshot.threads.find((candidate) => candidate.id === threadId);
		return (
			this.store.selectedThreadId === threadId &&
			this.store.selectionRevision === selectionRevision &&
			Boolean(thread && !thread.working && this.store.snapshot.connection === "live")
		);
	}

	private canStart(threadId: string, selectionRevision: number, actionId: string): boolean {
		return (
			this.isTargetReady(threadId, selectionRevision) &&
			!this.inFlightActionIds.has(actionId) &&
			!this.inFlightThreadIds.has(threadId) &&
			(this.cooldownUntil.get(threadId) ?? 0) <= performance.now()
		);
	}

	private async showFeedback(
		action: KeyDownEvent["action"],
		kind: CommandFeedbackKind,
		expectedGeneration = this.appearanceGenerations.get(action.id),
	): Promise<void> {
		if (!this.visibleActionIds.has(action.id) || this.appearanceGenerations.get(action.id) !== expectedGeneration)
			return;
		const previousTimer = this.feedbackTimers.get(action.id);
		if (previousTimer) clearTimeout(previousTimer);
		this.feedback.set(action.id, kind);
		await action.setImage(renderCommandFeedback(kind));
		const timer = setTimeout(() => {
			this.feedbackTimers.delete(action.id);
			this.feedback.delete(action.id);
			if (this.visibleActionIds.has(action.id)) void this.render(action);
		}, 800);
		timer.unref();
		this.feedbackTimers.set(action.id, timer);
	}

	private clearHold(actionId: string): void {
		const hold = this.holds.get(actionId);
		if (hold) clearInterval(hold.timer);
		this.holds.delete(actionId);
	}

	private async renderVisibleActions(): Promise<void> {
		await Promise.all(
			this.actions.map(async (action) => {
				if (action.isKey() && this.visibleActionIds.has(action.id)) await this.render(action);
			}),
		);
	}

	private ensureAnimationTimer(): void {
		this.animationTimer ??= setInterval(() => {
			if (
				this.store.selectedThread &&
				(this.store.selectedThread.working ||
					this.store.snapshot.connection !== "live" ||
					this.inFlightActionIds.size > 0 ||
					this.cooldownUntil.size > 0)
			) {
				void this.renderVisibleActions();
			}
		}, 200);
		this.animationTimer.unref();
	}

	private render(action: KeyDownEvent["action"]): Promise<void> {
		const feedback = this.feedback.get(action.id);
		if (feedback) return action.setImage(renderCommandFeedback(feedback));
		const thread = this.store.selectedThread;
		const inFlight = this.inFlightActionIds.has(action.id);
		const coolingDown = Boolean(thread && (this.cooldownUntil.get(thread.id) ?? 0) > performance.now());
		const available = Boolean(
			thread &&
			!thread.working &&
			this.store.snapshot.connection === "live" &&
			!inFlight &&
			!this.inFlightThreadIds.has(thread.id) &&
			!coolingDown,
		);
		const hold = this.holds.get(action.id);
		const progress = hold ? Math.min(1, (performance.now() - hold.startedAt) / this.definition.holdMs) : 0;
		const footer = thread?.working ? "" : inFlight ? "BUSY" : coolingDown ? "SENT" : available ? "" : "UNAVAILABLE";

		return action.setImage(
			renderCommandKey({
				label: this.definition.label,
				detail: thread?.title ?? "Select thread",
				color: this.definition.color,
				dimmed: !available,
				footer,
				progress: hold ? progress : undefined,
				loading: Boolean(thread && !available),
				icon: this.definition.icon,
			}),
		);
	}
}

const reviewPrompt =
	"Review the current changes for correctness and regressions. Prioritize substantive findings, fix high-confidence issues, and report remaining risks.";

@action({ UUID: "com.daniel-insley.amp-deck.archive" })
export class ArchiveThread extends CliThreadCommand {
	constructor(store: ThreadStore) {
		super(store, {
			label: "ARCHIVE",
			color: "#D6A038",
			icon: "archive",
			holdMs: 1500,
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
			execute: (threadId) =>
				launchAmpCommand(["--no-color", "--execute", reviewPrompt, "threads", "continue", threadId]),
		});
	}
}
