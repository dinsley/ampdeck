import {
	formatCompactDuration,
	formatCompactRelativeTime,
	splitTitle,
	type DisplayModel,
	type PhaseMetadata,
	type VisualStatus,
} from "../model/thread-status";
import type { AmpTopSnapshot, AmpTopThread } from "../amp/amp-top-model";
import { renderBusyIndicator } from "./busy-indicator";
import { renderSvgTemplate, svgDataUrl } from "./svg-template";
import { escapeXml, splitGraphemes, truncateText } from "./text";

const surfaceColor = "#FEF3C7";
const inkColor = "#0B0D0B";
const strongTextColor = "#27251D";
const mutedTextColor = "#665F45";
const borderColor = "#D8C98F";
const statusBorderColor = "#C8D0C8";

const statusColors: Record<VisualStatus, string> = {
	idle: "#52606D",
	running: "#286986",
	shipping: "#A64732",
	done: "#26734D",
};

export type EncoderFocusSurfaceInput = {
	thread: AmpTopThread;
	model: DisplayModel;
	animationFrame: number;
	position: string;
	phase?: PhaseMetadata;
	now?: number;
};

export function renderEncoderFocusSlice(
	template: string,
	input: EncoderFocusSurfaceInput & { column: number },
): string {
	return svgDataUrl(renderEncoderFocusSvg(template, input, `${input.column * 200} 0 200 100`));
}

export function renderEncoderFocusSurfaceSvg(template: string, input: EncoderFocusSurfaceInput): string {
	return renderEncoderFocusSvg(template, input, "0 0 800 100");
}

export function renderEncoderEmptySlice(template: string, column: number, snapshot: AmpTopSnapshot): string {
	return svgDataUrl(renderEncoderEmptySvg(template, snapshot, `${column * 200} 0 200 100`));
}

export function renderEncoderEmptySurfaceSvg(template: string, snapshot: AmpTopSnapshot): string {
	return renderEncoderEmptySvg(template, snapshot, "0 0 800 100");
}

function renderEncoderFocusSvg(template: string, input: EncoderFocusSurfaceInput, viewBox: string): string {
	const now = input.now ?? Date.now();
	const project = escapeXml(truncateText((input.thread.project ?? "Amp thread").toUpperCase(), 64));
	const position = escapeXml(input.position);
	const status = escapeXml(input.model.status);
	const statusColor = statusColors[input.model.visualStatus];
	const updated = escapeXml(formatCompactRelativeTime(input.thread.updatedAt, now));
	const usage = escapeXml(truncateText(input.thread.usageCost ?? "—", 9));
	const executorColor = "#595959";
	const executorTextColor = input.thread.executorConnected ? strongTextColor : mutedTextColor;
	const executorGlyph = renderExecutorGlyph(input.thread.executorConnected, executorColor);
	const activityDetail = escapeXml(truncateText(getActivityDetail(input.model), 27));
	const titleLines = splitTitle(input.thread.title);
	const titleWidth = Math.max(splitGraphemes(titleLines[0]).length, 1);
	const titleFontSize = titleLines.length === 1 ? Math.max(18, Math.min(25, Math.floor(850 / titleWidth))) : 18;
	const titleMarkup =
		titleLines.length === 1
			? `<text x="18" y="53" fill="${inkColor}" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[0])}</text>`
			: `<text x="18" y="40" fill="${inkColor}" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[0])}</text>
			<text x="18" y="61" fill="${inkColor}" font-size="${titleFontSize}" font-weight="700">${escapeXml(titleLines[1])}</text>`;
	const phaseDuration = escapeXml(formatCompactDuration(now - (input.phase?.startedAt ?? now)));
	const activity =
		input.model.visualStatus === "running" || input.model.visualStatus === "shipping"
			? renderBusyIndicator({
					centerX: 624,
					centerY: 50,
					frame: input.animationFrame,
					dotRadius: 1.35,
					gap: 4.6,
					color: inkColor,
					opacity: 0.82,
				})
			: `<circle cx="624" cy="50" r="3.5" fill="${statusColor}"/>`;

	return renderSvgTemplate(template, {
		viewBox,
		surfaceColor,
		accentColor: statusColor,
		project,
		mutedTextColor,
		position,
		titleMarkup,
		executorGlyph,
		executorTextColor,
		executorLabel: getExecutorLabel(input.thread),
		strongTextColor,
		updated,
		usage,
		borderColor,
		statusBorderColor,
		phaseDuration,
		activity,
		statusColor,
		statusFontSize: input.model.status.length > 10 ? 16 : 20,
		status,
		activityDetail,
	});
}

function renderEncoderEmptySvg(template: string, snapshot: AmpTopSnapshot, viewBox: string): string {
	const status =
		snapshot.connection === "offline"
			? "AMP CLI OFFLINE"
			: snapshot.connection === "connecting"
				? "CONNECTING TO AMP"
				: "NO ACTIVE THREADS";
	const detail =
		snapshot.connection === "offline"
			? "Retrying automatically · check amp top"
			: snapshot.connection === "connecting"
				? "Starting live thread inventory"
				: "Waiting for an unarchived thread";
	return renderSvgTemplate(template, {
		viewBox,
		surfaceColor,
		inkColor,
		status,
		mutedTextColor,
		detail,
		borderColor,
	});
}

function getActivityDetail(model: DisplayModel): string {
	if (model.status === "SHIPPING") return "Shipping workflow active";
	if (model.status === "WORKING") return "Planning or using tools";
	if (model.status === "DONE") return "Task turn completed";
	return "Ready for another command";
}

function getExecutorLabel(thread: AmpTopThread): string {
	return thread.executorConnected ? "EXECUTOR CONNECTED" : "NO ACTIVE EXECUTOR";
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
