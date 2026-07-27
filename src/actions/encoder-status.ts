import streamDeck, {
	action,
	DialRotateEvent,
	SingletonAction,
	TouchTapEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import encoderEmptyTemplate from "../assets/encoder-empty.svg";
import encoderFocusTemplate from "../assets/encoder-focus.svg";
import type { AmpTopSnapshot, AmpTopThread } from "../amp/amp-top-source";
import { isAmpThreadUrl } from "../amp/thread-url";
import { getErrorMessage } from "../error-message";
import {
	chooseFocusedThread,
	getDisplayModel,
	orderThreadsByAttention,
	updatePhaseMetadata,
	type DisplayModel,
	type PhaseMetadata,
} from "../model/thread-status";
import { busyIndicatorFrameDurationMs } from "../rendering/busy-indicator";
import { renderEncoderEmptySlice, renderEncoderFocusSlice } from "../rendering/encoder-surface";
import { ThreadStore } from "../state/thread-store";

const clockRefreshIntervalMs = 30_000;

type EncoderAction = DialRotateEvent["action"];

@action({ UUID: "com.dinsley.ampdeck.status" })
export class EncoderStatus extends SingletonAction {
	private animationTimer: NodeJS.Timeout | undefined;
	private readonly phaseMetadata = new Map<string, PhaseMetadata>();
	private readonly visibleActionIds = new Set<string>();
	private clockRefreshBucket = Math.floor(Date.now() / clockRefreshIntervalMs);
	private focusedThreadId: string | undefined;
	private releaseStore: (() => void) | undefined;
	private snapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };

	constructor(private readonly store: ThreadStore) {
		super();
		this.store.subscribe((snapshot) => {
			this.snapshot = snapshot;
			void this.reconcileSnapshot().catch((error) => {
				streamDeck.logger.error(`Unable to render thread status: ${getErrorMessage(error)}`);
			});
		});
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isDial()) {
			return;
		}

		this.visibleActionIds.add(ev.action.id);
		this.animationTimer ??= setInterval(() => {
			void this.refreshDynamicActions().catch((error) => {
				streamDeck.logger.error(`Unable to refresh thread status: ${getErrorMessage(error)}`);
			});
		}, busyIndicatorFrameDurationMs);
		this.animationTimer.unref();
		this.releaseStore ??= this.store.acquire();
		this.ensureFocusedThread();
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.visibleActionIds.delete(ev.action.id);
		if (this.visibleActionIds.size === 0) {
			if (this.animationTimer) clearInterval(this.animationTimer);
			this.animationTimer = undefined;
			this.releaseStore?.();
			this.releaseStore = undefined;
		}
	}

	override onDialDown(): void {
		if (this.focusedThreadId) {
			this.store.selectThread(this.focusedThreadId);
		}
	}

	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		const thread = this.getDisplayedThread();
		if (!thread) {
			return;
		}

		if (ev.payload.hold) {
			if (thread.url && isAmpThreadUrl(thread.url)) {
				try {
					await streamDeck.system.openUrl(thread.url);
				} catch (error) {
					streamDeck.logger.warn(`Unable to open displayed thread: ${getErrorMessage(error)}`);
					await ev.action.showAlert();
				}
			}
			return;
		}

		this.store.selectThread(thread.id);
	}

	override onDialRotate(ev: DialRotateEvent): void {
		const candidates = this.getAttentionOrderedThreads();
		if (candidates.length === 0) {
			return;
		}
		const currentIndex = candidates.findIndex((thread) => thread.id === this.focusedThreadId);
		const startingIndex = currentIndex >= 0 ? currentIndex : ev.payload.ticks > 0 ? -1 : 0;
		const nextIndex = wrap(startingIndex + ev.payload.ticks, candidates.length);
		const nextThreadId = candidates[nextIndex].id;
		this.focusedThreadId = nextThreadId;
		this.store.selectThread(nextThreadId);
	}

	private async reconcileSnapshot(): Promise<void> {
		if (this.snapshot.connection === "live") {
			updatePhaseMetadata(
				this.phaseMetadata,
				this.snapshot.threads.map((thread) => ({
					id: thread.id,
					status: getDisplayModel(thread).status,
				})),
			);
		} else {
			this.phaseMetadata.clear();
		}
		this.ensureFocusedThread();
		await this.renderVisibleActions();
	}

	private ensureFocusedThread(): void {
		const next = chooseFocusedThread(this.snapshot.threads, this.store.selectedThreadId, this.focusedThreadId);
		this.focusedThreadId = next?.id;
		if (next && this.store.selectedThreadId !== next.id) {
			this.store.selectThread(next.id);
		} else if (!next && this.store.selectedThreadId) {
			this.store.clearSelection(this.store.selectedThreadId);
		}
	}

	private async renderVisibleActions(): Promise<void> {
		await Promise.all(
			this.actions.map(async (action) => {
				if (!action.isDial()) {
					return;
				}

				if (this.visibleActionIds.has(action.id)) await this.render(action);
			}),
		);
	}

	private async refreshDynamicActions(): Promise<void> {
		const clockRefreshBucket = Math.floor(Date.now() / clockRefreshIntervalMs);
		const clockRefreshDue = clockRefreshBucket !== this.clockRefreshBucket;
		if (clockRefreshDue) this.clockRefreshBucket = clockRefreshBucket;
		await Promise.all(
			this.actions.map(async (action) => {
				if (!action.isDial()) {
					return;
				}

				if (!this.visibleActionIds.has(action.id)) {
					return;
				}

				const displayed = this.getDisplayedThread();
				if (clockRefreshDue || displayed?.working || displayed?.phase === "shipping") {
					await this.render(action);
				}
			}),
		);
	}

	private async render(action: EncoderAction): Promise<void> {
		if (this.snapshot.connection !== "live") {
			return action.setFeedback({
				canvas: renderEncoderEmptySlice(encoderEmptyTemplate, action.coordinates.column, this.snapshot),
			});
		}

		const thread = this.getDisplayedThread();
		const animationFrame = Math.floor(Date.now() / busyIndicatorFrameDurationMs);
		if (thread) {
			return this.renderFocused(action, thread, getDisplayModel(thread), animationFrame);
		}
		return action.setFeedback({
			canvas: renderEncoderEmptySlice(encoderEmptyTemplate, action.coordinates.column, this.snapshot),
		});
	}

	private renderFocused(
		action: EncoderAction,
		thread: AmpTopThread,
		model: DisplayModel,
		animationFrame: number,
	): Promise<void> {
		const column = action.coordinates.column;
		const orderedThreads = this.getAttentionOrderedThreads();
		const threadIndex = orderedThreads.findIndex((candidate) => candidate.id === thread.id);
		const phase = this.phaseMetadata.get(thread.id);
		return action.setFeedback({
			canvas: renderEncoderFocusSlice(encoderFocusTemplate, {
				column,
				thread,
				model,
				animationFrame,
				position: threadIndex >= 0 ? `${threadIndex + 1}/${orderedThreads.length}` : "",
				phase,
			}),
		});
	}

	private getDisplayedThread(): AmpTopThread | undefined {
		return this.snapshot.threads.find((thread) => thread.id === this.focusedThreadId);
	}

	private getAttentionOrderedThreads(): AmpTopThread[] {
		return orderThreadsByAttention(this.snapshot.threads);
	}
}

function wrap(value: number, length: number): number {
	return ((value % length) + length) % length;
}
