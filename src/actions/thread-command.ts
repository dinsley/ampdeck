import {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { BridgeServer } from "../bridge/bridge-server";
import type { ThreadCommandIntent, ThreadCommandName } from "../bridge/protocol";
import { renderCommandFeedback, renderCommandKey, type CommandFeedbackKind } from "../rendering/command-key";
import { ThreadStore } from "../state/thread-store";

type CommandDefinition = {
	label: string;
	color: string;
	icon: "ship";
	command: ThreadCommandName;
	content?: string;
	holdMs?: number;
	intent?: ThreadCommandIntent;
};

type HoldState = {
	threadId: string;
	selectionRevision: number;
	startedAt: number;
	timer: NodeJS.Timeout;
};

abstract class ThreadCommand extends SingletonAction {
	private readonly appearanceGenerations = new Map<string, number>();
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
		private readonly bridge: BridgeServer,
		private readonly definition: CommandDefinition,
	) {
		super();
		this.store.subscribe(() => void this.renderVisibleActions());
		this.bridge.subscribe(() => void this.renderVisibleActions());
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

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
		if (!ev.action.isKey()) {
			return;
		}
		const thread = this.store.selectedThread;
		if (!thread || !this.canStart(thread.id, this.store.selectionRevision, ev.action.id)) {
			await this.showFeedback(ev.action, "unavailable");
			return;
		}

		if (!this.definition.holdMs) {
			await this.execute(ev.action, thread.id, this.store.selectionRevision);
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
		if (!ev.action.isKey() || !this.definition.holdMs) {
			return;
		}

		const hold = this.holds.get(ev.action.id);
		if (!hold) {
			return;
		}

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
		let result: CommandFeedbackKind = "success";
		try {
			await this.bridge.sendCommand(threadId, this.definition.command, this.definition.content, this.definition.intent);
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
		const alreadyShipping = this.definition.intent === "shipping" && thread?.phase === "shipping";
		return (
			this.store.selectedThreadId === threadId &&
			this.store.selectionRevision === selectionRevision &&
			Boolean(thread && !thread.working && !alreadyShipping && this.bridge.isThreadConnected(threadId))
		);
	}

	private canStart(threadId: string, selectionRevision: number, actionId: string): boolean {
		return (
			this.isTargetReady(threadId, selectionRevision) &&
			!this.inFlightActionIds.has(actionId) &&
			!this.inFlightThreadIds.has(threadId)
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
		if (hold) {
			clearInterval(hold.timer);
			this.holds.delete(actionId);
		}
	}

	private async renderVisibleActions(): Promise<void> {
		await Promise.all(
			this.actions.map(async (action) => {
				if (action.isKey() && this.visibleActionIds.has(action.id)) {
					await this.render(action);
				}
			}),
		);
	}

	private ensureAnimationTimer(): void {
		this.animationTimer ??= setInterval(() => {
			const thread = this.store.selectedThread;
			if (
				thread &&
				(this.inFlightActionIds.size > 0 ||
					thread.working ||
					thread.phase === "shipping" ||
					!this.bridge.isThreadConnected(thread.id))
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
		const alreadyShipping = this.definition.intent === "shipping" && thread?.phase === "shipping";
		const connected = Boolean(
			thread && !thread.working && this.bridge.isThreadConnected(thread.id) && !alreadyShipping,
		);
		const inFlight = this.inFlightActionIds.has(action.id);
		const threadInFlight = Boolean(thread && this.inFlightThreadIds.has(thread.id));
		const hold = this.holds.get(action.id);
		const progress =
			hold && this.definition.holdMs ? Math.min(1, (performance.now() - hold.startedAt) / this.definition.holdMs) : 0;
		const footer = alreadyShipping
			? "SHIPPING"
			: thread?.working
				? ""
				: inFlight || threadInFlight
					? "BUSY"
					: connected
						? ""
						: "OFFLINE";

		return action.setImage(
			renderCommandKey({
				label: this.definition.label,
				detail: thread?.title ?? "Select thread",
				color: this.definition.color,
				dimmed: !connected || inFlight || threadInFlight,
				footer,
				progress: hold ? progress : undefined,
				loading: Boolean(thread && (!connected || inFlight || threadInFlight)),
				icon: this.definition.icon,
			}),
		);
	}
}

const shipPrompt =
	"Prepare and carry out the repository's configured shipping workflow for the current changes. Before changing shared state, inspect project guidance and current git state, verify relevant checks, and clearly report the intended destination. Do not force-push, rewrite history, bypass approvals, or guess when the destination or workflow is ambiguous; stop and ask instead.";

@action({ UUID: "com.daniel-insley.amp-deck.ship" })
export class ShipThread extends ThreadCommand {
	constructor(store: ThreadStore, bridge: BridgeServer) {
		super(store, bridge, {
			label: "SHIP",
			color: "#F34E3F",
			icon: "ship",
			command: "append",
			content: shipPrompt,
			holdMs: 2000,
			intent: "shipping",
		});
	}
}
