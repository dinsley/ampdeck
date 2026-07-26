import streamDeck, {
	action,
	DialRotateEvent,
	SingletonAction,
	TouchTapEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import type { AmpTopSnapshot, AmpTopThread } from "../amp/amp-top-source";
import { isAmpThreadUrl } from "../amp/thread-url";
import { ThreadStore } from "../state/thread-store";
import {
	chooseFocusedThread,
	getOverview,
	orderThreadsByAttention,
	splitTitle,
	updatePhaseMetadata,
	type Overview,
	type PhaseMetadata,
} from "./encoder-status-model";

const animationIntervalMs = 250;
const focusLayout = "layouts/encoder-focus.json";
const surfaceColor = "#FEF3C7";
const inkColor = "#0B0D0B";
const strongTextColor = "#27251D";
const mutedTextColor = "#665F45";
const borderColor = "#D8C98F";

type VisualStatus = "idle" | "running" | "shipping" | "done" | "error";

const statusColors: Record<VisualStatus, string> = {
	idle: "#665F45",
	running: "#A65300",
	shipping: "#7651A8",
	done: "#257A4D",
	error: "#B42318",
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
			void this.reconcileSnapshot();
		});
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isDial()) {
			return;
		}

		this.visibleActionIds.add(ev.action.id);
		this.animationTimer ??= setInterval(() => void this.refreshRunningActions(), animationIntervalMs);
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

	override async onDialDown(): Promise<void> {
		if (this.focusedThreadId) {
			this.store.selectThread(this.focusedThreadId);
			await this.store.acknowledgeSelectedThread();
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
				if (displayed?.working || displayed?.phase === "shipping" || isAttentionThread(displayed)) {
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
				summary: getOverview(this.snapshot.threads),
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
	if (thread.companionConnected && thread.companionState && thread.phase) {
		const semantic = getSemanticStatus(thread.companionState, thread.phase);
		return {
			status: semantic.label,
			visualStatus: semantic.visualStatus,
		};
	}

	const visualStatus = thread.working ? "running" : thread.executorConnected ? "idle" : "done";
	return {
		status: thread.working ? "WORKING" : thread.executorConnected ? "IDLE" : "DONE",
		visualStatus,
	};
}

function getSemanticStatus(
	state: NonNullable<AmpTopThread["companionState"]>,
	phase: string,
): {
	label: string;
	visualStatus: VisualStatus;
} {
	if (state === "awaiting-approval") return { label: "NEEDS INPUT", visualStatus: "running" };
	if (state === "error") return { label: "ERROR", visualStatus: "error" };
	if (state === "cancelled") return { label: "CANCELLED", visualStatus: "idle" };
	if (state === "done" || phase === "done") return { label: "DONE", visualStatus: "done" };
	if (phase === "shipping") return { label: "SHIPPING", visualStatus: "shipping" };

	const labels: Record<string, string> = {
		working: "WORKING",
		thinking: "THINKING",
		researching: "RESEARCH",
		editing: "EDITING",
		testing: "TESTING",
		idle: "IDLE",
	};
	return {
		label: labels[phase] ?? phase.toUpperCase().slice(0, 11),
		visualStatus: state === "running" ? "running" : "idle",
	};
}

function wrap(value: number, length: number): number {
	return ((value % length) + length) % length;
}

function isAttentionThread(thread: AmpTopThread | undefined): boolean {
	return (
		thread?.companionState === "awaiting-approval" || thread?.companionState === "error" || thread?.unread === true
	);
}

function renderFocusSlice(input: {
	column: number;
	thread: AmpTopThread;
	model: DisplayModel;
	animationFrame: number;
	position: string;
	phase?: PhaseMetadata;
	summary: Overview;
}): string {
	const project = escapeXml((input.thread.project ?? "Amp thread").toUpperCase());
	const position = escapeXml(input.position);
	const status = escapeXml(input.model.status);
	const statusColor = statusColors[input.model.visualStatus];
	const accentColor = input.model.status === "NEEDS INPUT" || input.thread.unread ? statusColors.running : statusColor;
	const updated = escapeXml(formatRelativeUpdate(input.thread.updatedAt));
	const executorLabel = getExecutorLabel(input.thread);
	const executorColor = "#595959";
	const executorTextColor = input.thread.executorConnected ? strongTextColor : mutedTextColor;
	const executorKind =
		input.thread.executorKind === "local"
			? "local"
			: input.thread.executorConnected
				? "remote"
				: input.thread.executorKind;
	const executorGlyph = renderExecutorGlyph(executorKind, executorColor);
	const usageMarkup = input.thread.usageCost
		? `<text x="360" y="82" text-anchor="middle" fill="${mutedTextColor}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700">USAGE ${escapeXml(input.thread.usageCost)}</text>`
		: "";
	const activityDetail = escapeXml(getActivityDetail(input.thread, input.model));
	const overviewMarkup = renderOverview(input.summary);
	const titleLines = splitTitle(input.thread.title);
	const titleFontSize =
		titleLines.length === 1 ? Math.max(18, Math.min(25, Math.floor(850 / Math.max(titleLines[0].length, 1)))) : 18;
	const titleMarkup =
		titleLines.length === 1
			? `<text x="18" y="53" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[0])}</text>`
			: `<text x="18" y="40" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[0])}</text>
			<text x="18" y="61" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[1])}</text>`;
	const phaseDuration = escapeXml(formatDuration(Date.now() - (input.phase?.startedAt ?? Date.now())));
	const pulseRadius = [4.5, 5, 5.5, 5][input.animationFrame % 4];
	const spinnerRotation = ((input.animationFrame * animationIntervalMs) / 2600) * 360;
	const activity =
		input.model.visualStatus === "running" || input.model.visualStatus === "shipping"
			? `<g transform="rotate(${spinnerRotation} 624 50)" opacity=".6">
			<circle cx="624" cy="50" r="6" fill="none" stroke="${statusColor}" stroke-opacity=".18" stroke-width="1.7"/>
			<circle cx="624" cy="50" r="6" fill="none" stroke="${statusColor}" stroke-width="1.7" stroke-linecap="round" stroke-dasharray="23 15"/>
		</g>`
			: isAttentionThread(input.thread)
				? `<circle cx="624" cy="50" r="${pulseRadius}" fill="${statusColor}" opacity=".2"/><circle cx="624" cy="50" r="2.75" fill="${statusColor}"/>`
				: `<circle cx="624" cy="50" r="3.5" fill="${statusColor}"/>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${input.column * 200} 0 200 100">
		<style>text { font-family: 'Berkeley Mono V2', monospace !important; }</style>
		<rect width="800" height="100" fill="${surfaceColor}"/>
		<rect x="600" y="0" width="200" height="100" fill="${accentColor}" opacity=".035"/>
		<g transform="translate(18 3) scale(.625)" fill="none" stroke="#595959" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M18 19a5 5 0 0 1-5-5v8"/>
			<path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5"/>
			<circle cx="13" cy="12" r="2"/><circle cx="20" cy="19" r="2"/>
		</g>
		<text x="38" y="18" fill="#595959" font-family="Segoe UI, sans-serif" font-size="12" font-weight="700">${project}</text>
		${overviewMarkup}
		<text x="580" y="18" text-anchor="end" fill="${mutedTextColor}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="600">${position}</text>
		${titleMarkup}
		${executorGlyph}
		<text x="38" y="82" fill="${executorTextColor}" font-family="Segoe UI, sans-serif" font-size="12" font-weight="700">${executorLabel}</text>
		${usageMarkup}
		<text x="580" y="82" text-anchor="end" fill="${mutedTextColor}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="600">LAST UPDATED ${updated}</text>
		<line x1="600" y1="0" x2="600" y2="100" stroke="${borderColor}" stroke-width="2"/>
		<text x="620" y="18" fill="${mutedTextColor}" font-family="Segoe UI, sans-serif" font-size="12" font-weight="600">CURRENTLY</text>
		<text x="782" y="18" text-anchor="end" fill="${mutedTextColor}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="700">${phaseDuration}</text>
		${activity}
		<text x="638" y="56" fill="${statusColor}" font-family="Segoe UI, sans-serif" font-size="${input.model.status.length > 10 ? 16 : 20}" font-weight="700">${status}</text>
		<text x="620" y="82" fill="${strongTextColor}" font-family="Segoe UI, sans-serif" font-size="11">${truncate(activityDetail, 30)}</text>
	</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderEmptyFocusSlice(column: number, snapshot: AmpTopSnapshot): string {
	const status =
		snapshot.connection === "offline"
			? "AMP CLI OFFLINE"
			: snapshot.connection === "connecting"
				? "CONNECTING TO AMP"
				: snapshot.companionConnected === false
					? "COMPANION OFFLINE"
					: "NO ACTIVE THREADS";
	const detail =
		snapshot.connection !== "live"
			? "Thread inventory will reconnect automatically"
			: snapshot.companionConnected === false
				? "Browsing is available; thread commands need Amp"
				: "Waiting for an unarchived thread";
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${column * 200} 0 200 100">
		<style>text { font-family: 'Berkeley Mono V2', monospace !important; }</style>
		<rect width="800" height="100" fill="${surfaceColor}"/>
		<text x="400" y="45" text-anchor="middle" fill="${inkColor}" font-family="Segoe UI, sans-serif" font-size="22" font-weight="700">${status}</text>
		<text x="400" y="70" text-anchor="middle" fill="${mutedTextColor}" font-family="Segoe UI, sans-serif" font-size="13">${detail}</text>
		<rect x="0" y="96" width="800" height="3" fill="${borderColor}"/>
	</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function truncate(value: string, length: number): string {
	return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function renderOverview(summary: Overview): string {
	return [
		{ count: summary.alerts, label: "ALERT", color: "#B42318" },
		{ count: summary.unread, label: "NEW", color: "#3F5FA8" },
	]
		.filter(({ count }) => count > 0)
		.map((item, index) => renderOverviewItem(390 + index * 90, item.count, item.label, item.color))
		.join("");
}

function renderOverviewItem(x: number, count: number, label: string, color: string): string {
	return `<circle cx="${x}" cy="14" r="3" fill="${color}"/><text x="${x + 9}" y="18" fill="${color}" font-family="Segoe UI, sans-serif" font-size="10" font-weight="700">${count} ${label}</text>`;
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
	if (model.status === "NEEDS INPUT") return "Approval or input required";
	if (model.status === "SHIPPING") return "Changes workflow in progress";
	if (model.status === "RESEARCH") return "Inspecting code and context";
	if (model.status === "EDITING") return "Applying code changes";
	if (model.status === "TESTING") return "Running project validation";
	if (model.status === "THINKING") return "Reasoning about the next step";
	if (model.status === "WORKING") return "Planning or executing next step";
	if (model.status === "ERROR") return "Thread needs attention";
	if (model.status === "DONE") return "Task turn completed";
	if (model.status === "CANCELLED") return "Work was stopped";
	if (model.status === "IDLE") return "Ready for another command";
	if (thread.working) return "Agent is actively working";
	if (thread.executorConnected) return "Ready for another command";
	return "No live executor connected";
}

function getExecutorLabel(thread: AmpTopThread): string {
	if (thread.executorKind === "local") return "LOCAL";
	if (thread.executorKind === "remote") return "ORB";
	return thread.executorConnected ? "ORB" : "NO ACTIVE EXECUTOR";
}

function renderExecutorGlyph(kind: AmpTopThread["executorKind"], color: string): string {
	if (kind === "local") {
		return `<g transform="translate(18 69) scale(.5833)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect width="20" height="14" x="2" y="3" rx="2"/>
			<path d="M8 21h8m-4-4v4"/>
		</g>`;
	}
	if (kind === "remote") {
		return `<g transform="translate(18 69) scale(.5833)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="10"/>
			<path d="M17 12c0-2.761-2.239-5-5-5"/>
		</g>`;
	}
	return `<circle cx="25" cy="76" r="3" fill="${color}"/>`;
}
