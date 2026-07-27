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
const metadataBaseline = 84;
const metadataHorizontalPadding = 10;
const metadataIconTextOffset = 42;
const metadataLabelFontSize = 12;
const metadataValueFontSize = 12;
const metadataOriginWidth = 245;
const metadataTokensWidth = 125;
const metadataUpdatedWidth = 120;
const metadataCostWidth = 110;
let cachedOrbIconBody = "";
let cachedOrbIconTemplate = "";

type MetadataItem =
	| { width: number; value: string; label: string; icon?: never }
	| { width: number; value: string; icon: string; label?: never };

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
	orbIconTemplate: string,
	input: EncoderFocusSurfaceInput & { column: number },
): string {
	return svgDataUrl(renderEncoderFocusSvg(template, orbIconTemplate, input, `${input.column * 200} 0 200 100`));
}

export function renderEncoderFocusSurfaceSvg(
	template: string,
	orbIconTemplate: string,
	input: EncoderFocusSurfaceInput,
): string {
	return renderEncoderFocusSvg(template, orbIconTemplate, input, "0 0 800 100");
}

export function renderEncoderEmptySlice(template: string, column: number, snapshot: AmpTopSnapshot): string {
	return svgDataUrl(renderEncoderEmptySvg(template, snapshot, `${column * 200} 0 200 100`));
}

export function renderEncoderEmptySurfaceSvg(template: string, snapshot: AmpTopSnapshot): string {
	return renderEncoderEmptySvg(template, snapshot, "0 0 800 100");
}

function renderEncoderFocusSvg(
	template: string,
	orbIconTemplate: string,
	input: EncoderFocusSurfaceInput,
	viewBox: string,
): string {
	const now = input.now ?? Date.now();
	const project = escapeXml(truncateText((input.thread.project?.trim() || "Amp thread").toUpperCase(), 64));
	const position = escapeXml(input.position);
	const status = escapeXml(input.model.status);
	const statusColor = statusColors[input.model.visualStatus];
	const updated = escapeXml(formatCompactRelativeTime(input.thread.updatedAt, now));
	const usage = escapeXml(truncateText(formatUsageCost(input.thread.usageCost), 7));
	const tokens = escapeXml(formatCompactTokens(input.thread.tokensUsed));
	const originColor = input.thread.executorConnected ? "#26734D" : mutedTextColor;
	const originGlyph = renderOriginGlyph(input.thread.executionOrigin, originColor, orbIconTemplate);
	const metadata = renderMetadata([
		{ width: metadataOriginWidth, value: getOriginLabel(input.thread), icon: originGlyph },
		{ width: metadataTokensWidth, label: "TOKENS", value: tokens },
		{ width: metadataUpdatedWidth, label: "UPDATED", value: updated },
		{ width: metadataCostWidth, label: "COST", value: usage },
	]);
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
		metadata,
		strongTextColor,
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

export function formatCompactTokens(tokens: number | undefined): string {
	if (tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return "——";
	if (tokens < 1_000) return Math.round(tokens).toString();
	if (tokens < 1_000_000) return `${formatCompactTokenNumber(tokens, 1_000)}K`;
	return `${formatCompactTokenNumber(tokens, 1_000_000)}M`;
}

export function formatUsageCost(cost: string | undefined): string {
	if (!cost) return "——";
	const match = /^([$€£])\s?(\d+)(?:\.(\d+))?$/u.exec(cost.trim());
	if (!match) return cost;
	const [, currency, integer, fraction = ""] = match;
	const targetFractionLength = Math.max(0, 4 - integer.length);
	if (fraction.length >= targetFractionLength) return `${currency}${integer}${fraction ? `.${fraction}` : ""}`;
	return `${currency}${integer}.${fraction.padEnd(targetFractionLength, "0")}`;
}

function formatCompactTokenNumber(tokens: number, divisor: number): string {
	return (Math.trunc((tokens / divisor) * 100) / 100).toFixed(2);
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

function getOriginLabel(thread: AmpTopThread): string {
	if (thread.executionOrigin === "cli") return "LOCAL";
	if (thread.executionOrigin === "orb") return "ORB";
	if (thread.executionOrigin === "virtual") return "VIRTUAL";
	return "UNKNOWN";
}

function renderMetadata(items: MetadataItem[]): string {
	let x = 0;
	return items
		.map((item, index) => {
			const divider =
				index === 0
					? ""
					: `<line x1="${x + 0.5}" y1="73" x2="${x + 0.5}" y2="87" stroke="${borderColor}" stroke-width="1"/>`;
			const content = item.icon
				? `<g transform="translate(${x} 0)">${item.icon}</g><text x="${x + metadataIconTextOffset}" y="${metadataBaseline}" fill="${strongTextColor}" font-size="${metadataValueFontSize}" font-weight="700">${item.value}</text>`
				: `<text x="${x + metadataHorizontalPadding}" y="${metadataBaseline}" fill="${mutedTextColor}" font-size="${metadataLabelFontSize}" font-weight="700" letter-spacing=".25">${item.label}</text>
			<text x="${x + item.width - metadataHorizontalPadding}" y="${metadataBaseline}" text-anchor="end" fill="${strongTextColor}" font-size="${metadataValueFontSize}" font-weight="700">${item.value}</text>`;
			x += item.width;
			return `${divider}${content}`;
		})
		.join("\n");
}

function renderOriginGlyph(origin: AmpTopThread["executionOrigin"], color: string, orbIconTemplate: string): string {
	if (origin === "cli") {
		return `<g data-origin-glyph="local" transform="translate(18 72) scale(.6667)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="1" y="1" width="22" height="18" rx="2"/><path d="m6 7 3 3-3 3m6 0h5"/>
		</g>`;
	}
	if (origin === "orb") {
		const iconBody = getOrbIconBody(orbIconTemplate);
		return `<g data-origin-glyph="orb" transform="translate(18 72) scale(.6667)" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">${iconBody}</g>`;
	}
	if (origin === "virtual") {
		return `<g data-origin-glyph="virtual" transform="translate(18 72) scale(.6667)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m12 1 10 11-10 11L2 12z" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="3"/>
		</g>`;
	}
	return `<g data-origin-glyph="unknown" transform="translate(18 72) scale(.6667)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round">
		<circle cx="12" cy="12" r="10"/><path d="M9 9a3 3 0 1 1 4 2.83V14m-1 4h.01"/>
	</g>`;
}

function getOrbIconBody(template: string): string {
	if (template !== cachedOrbIconTemplate) {
		cachedOrbIconTemplate = template;
		cachedOrbIconBody = template.slice(template.indexOf(">") + 1, template.lastIndexOf("</svg>"));
	}
	return cachedOrbIconBody;
}
