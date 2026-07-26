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
import { renderSvgTemplate, svgDataUrl } from "../rendering/svg-template";
import { ThreadStore } from "../state/thread-store";
import {
	chooseFocusedThread,
	orderThreadsByAttention,
	splitTitle,
	updatePhaseMetadata,
	type PhaseMetadata,
} from "./encoder-status-model";

const animationIntervalMs = 250;
const focusLayout = "layouts/encoder-focus.json";
const surfaceColor = "#FEF3C7";
const inkColor = "#0B0D0B";
const strongTextColor = "#27251D";
const mutedTextColor = "#665F45";
const borderColor = "#D8C98F";

type VisualStatus = "idle" | "running" | "shipping" | "done";

const statusColors: Record<VisualStatus, string> = {
	idle: "#665F45",
	running: "#A65300",
	shipping: "#7651A8",
	done: "#257A4D",
};

type EncoderAction = DialRotateEvent["action"];

@action({ UUID: "com.daniel-insley.amp-deck.status" })
export class EncoderStatus extends SingletonAction {
	private animationTimer: NodeJS.Timeout | undefined;
	private readonly focusedLayoutActionIds = new Set<string>();
	private readonly phaseMetadata = new Map<string, PhaseMetadata>();
	private readonly visibleActionIds = new Set<string>();
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
			void this.refreshRunningActions().catch((error) => {
				streamDeck.logger.error(`Unable to refresh thread status: ${getErrorMessage(error)}`);
			});
		}, animationIntervalMs);
		this.animationTimer.unref();
		this.releaseStore ??= this.store.acquire();
		this.ensureFocusedThread();
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.focusedLayoutActionIds.delete(ev.action.id);
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
				await streamDeck.system.openUrl(thread.url);
			}
			return;
		}

		this.store.selectThread(thread.id);
		await this.renderVisibleActions();
	}

	override async onDialRotate(ev: DialRotateEvent): Promise<void> {
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
		await this.renderVisibleActions();
	}

	private async reconcileSnapshot(): Promise<void> {
		updatePhaseMetadata(
			this.phaseMetadata,
			this.snapshot.threads.map((thread) => ({
				id: thread.id,
				status: getDisplayModel(thread).status,
			})),
		);
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

	private async refreshRunningActions(): Promise<void> {
		await Promise.all(
			this.actions.map(async (action) => {
				if (!action.isDial()) {
					return;
				}

				if (!this.visibleActionIds.has(action.id)) {
					return;
				}

				const displayed = this.getDisplayedThread();
				if (displayed?.working || displayed?.phase === "shipping") {
					await this.render(action);
				}
			}),
		);
	}

	private async render(action: EncoderAction): Promise<void> {
		const thread = this.getDisplayedThread();
		const animationFrame = Math.floor(Date.now() / animationIntervalMs);
		if (!this.focusedLayoutActionIds.has(action.id)) {
			await action.setFeedbackLayout(focusLayout);
			this.focusedLayoutActionIds.add(action.id);
		}
		if (thread) {
			return this.renderFocused(action, thread, getDisplayModel(thread), animationFrame);
		}
		return action.setFeedback({ canvas: renderEmptyFocusSlice(action.coordinates.column, this.snapshot) });
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
			canvas: renderFocusSlice({
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

type DisplayModel = {
	status: string;
	visualStatus: VisualStatus;
};

function getDisplayModel(thread: AmpTopThread): DisplayModel {
	if (thread.phase === "shipping") {
		return { status: "SHIPPING", visualStatus: "shipping" };
	}

	const visualStatus = thread.working ? "running" : thread.executorConnected ? "idle" : "done";
	return {
		status: thread.working ? "WORKING" : thread.executorConnected ? "IDLE" : "DONE",
		visualStatus,
	};
}

function wrap(value: number, length: number): number {
	return ((value % length) + length) % length;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
function renderFocusSlice(input: {
	column: number;
	thread: AmpTopThread;
	model: DisplayModel;
	animationFrame: number;
	position: string;
	phase?: PhaseMetadata;
}): string {
	const project = escapeXml((input.thread.project ?? "Amp thread").toUpperCase());
	const position = escapeXml(input.position);
	const status = escapeXml(input.model.status);
	const statusColor = statusColors[input.model.visualStatus];
	const accentColor = statusColor;
	const updated = escapeXml(formatRelativeUpdate(input.thread.updatedAt));
	const usage = escapeXml(input.thread.usageCost ?? "—");
	const usageMarkup = `<tspan fill="${mutedTextColor}"> • COST </tspan><tspan fill="${strongTextColor}" font-weight="700">${usage}</tspan>`;
	const executorLabel = getExecutorLabel(input.thread);
	const executorColor = "#595959";
	const executorTextColor = input.thread.executorConnected ? strongTextColor : mutedTextColor;
	const executorGlyph = renderExecutorGlyph(input.thread.executorConnected, executorColor);
	const activityDetail = escapeXml(getActivityDetail(input.thread, input.model));
	const titleLines = splitTitle(input.thread.title);
	const titleFontSize =
		titleLines.length === 1 ? Math.max(18, Math.min(25, Math.floor(850 / Math.max(titleLines[0].length, 1)))) : 18;
	const titleMarkup =
		titleLines.length === 1
			? `<text x="18" y="53" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[0])}</text>`
			: `<text x="18" y="40" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[0])}</text>
			<text x="18" y="61" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[1])}</text>`;
	const phaseDuration = escapeXml(formatDuration(Date.now() - (input.phase?.startedAt ?? Date.now())));
	const spinnerRotation = ((input.animationFrame * animationIntervalMs) / 2600) * 360;
	const activity =
		input.model.visualStatus === "running" || input.model.visualStatus === "shipping"
			? `<g transform="rotate(${spinnerRotation} 624 50)" opacity=".6">
			<circle cx="624" cy="50" r="6" fill="none" stroke="${statusColor}" stroke-opacity=".18" stroke-width="1.7"/>
			<circle cx="624" cy="50" r="6" fill="none" stroke="${statusColor}" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="23 15"/>
		</g>`
			: `<circle cx="624" cy="50" r="3.5" fill="${statusColor}"/>`;
	return svgDataUrl(
		renderSvgTemplate(encoderFocusTemplate, {
			viewBox: `${input.column * 200} 0 200 100`,
			surfaceColor,
			accentColor,
			project,
			mutedTextColor,
			position,
			titleMarkup,
			executorGlyph,
			executorTextColor,
			executorLabel,
			strongTextColor,
			updated,
			usageMarkup,
			borderColor,
			phaseDuration,
			activity,
			statusColor,
			statusFontSize: input.model.status.length > 10 ? 16 : 20,
			status,
			activityDetail: truncate(activityDetail, 30),
		}),
	);
}

function renderEmptyFocusSlice(column: number, snapshot: AmpTopSnapshot): string {
	const status =
		snapshot.connection === "offline"
			? "AMP CLI OFFLINE"
			: snapshot.connection === "connecting"
				? "CONNECTING TO AMP"
				: "NO ACTIVE THREADS";
	const detail =
		snapshot.connection !== "live"
			? "Thread inventory will reconnect automatically"
			: "Waiting for an unarchived thread";
	return svgDataUrl(
		renderSvgTemplate(encoderEmptyTemplate, {
			viewBox: `${column * 200} 0 200 100`,
			surfaceColor,
			inkColor,
			status,
			mutedTextColor,
			detail,
			borderColor,
		}),
	);
}

function truncate(value: string, length: number): string {
	return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function formatDuration(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function formatRelativeUpdate(updatedAt: string | undefined): string {
	if (!updatedAt) return "UNKNOWN";
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(updatedAt)) / 1000));
	if (!Number.isFinite(elapsedSeconds)) return "UNKNOWN";
	if (elapsedSeconds < 5) return "NOW";
	if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) return `${elapsedHours}h`;
	return `${Math.floor(elapsedHours / 24)}d`;
}

function getActivityDetail(thread: AmpTopThread, model: DisplayModel): string {
	if (model.status === "SHIPPING") return "Changes workflow in progress";
	if (model.status === "WORKING") return "Planning or executing next step";
	if (model.status === "DONE") return "Task turn completed";
	if (model.status === "IDLE") return "Ready for another command";
	if (thread.working) return "Agent is actively working";
	if (thread.executorConnected) return "Ready for another command";
	return "No live executor connected";
}

function getExecutorLabel(thread: AmpTopThread): string {
	return thread.executorConnected ? "ORB" : "NO ACTIVE EXECUTOR";
}

function renderExecutorGlyph(connected: boolean, color: string): string {
	if (connected) {
		return `<g transform="translate(18 72) scale(.625)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="10"/>
			<path d="M17 12c0-2.761-2.239-5-5-5"/>
		</g>`;
	}
	return `<circle cx="25.5" cy="79.5" r="3" fill="${color}"/>`;
}
