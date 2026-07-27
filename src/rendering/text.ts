import { escapeUTF8 } from "entities";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function escapeXml(value: string): string {
	return escapeUTF8(value.toWellFormed());
}

export function splitGraphemes(value: string): string[] {
	return Array.from(graphemeSegmenter.segment(value.toWellFormed()), ({ segment }) => segment);
}

export function truncateText(value: string, maximumLength: number): string {
	const graphemes = splitGraphemes(value);
	if (maximumLength <= 0) return "";
	return graphemes.length > maximumLength
		? `${graphemes.slice(0, Math.max(0, maximumLength - 1)).join("")}…`
		: graphemes.join("");
}
