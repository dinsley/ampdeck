import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AmpTopThread } from "../src/amp/amp-top-model.ts";
import { getDisplayModel } from "../src/model/thread-status.ts";
import {
	formatCompactTokens,
	formatUsageCost,
	renderEncoderEmptySurfaceSvg,
	renderEncoderFocusSurfaceSvg,
} from "../src/rendering/encoder-surface.ts";

const focusTemplate = readFileSync(new URL("../src/assets/encoder-focus.svg", import.meta.url), "utf8");
const emptyTemplate = readFileSync(new URL("../src/assets/encoder-empty.svg", import.meta.url), "utf8");
const now = Date.parse("2026-07-26T12:00:00Z");

describe("encoder surface rendering", () => {
	it("renders updated and cost metadata as separate fixed-position groups", () => {
		const thread = createThread({
			project: "ampdeck",
			title: "AmpDeck code review",
			updatedAt: new Date(now - 14 * 60_000).toISOString(),
			usageCost: "$0.005",
			tokensUsed: 128_400,
		});
		const svg = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			phase: { current: "DONE", startedAt: now - 5 * 60_000 },
			now,
		});

		assert.match(svg, /<line x1="300" y1="74" x2="300" y2="86"/);
		assert.match(svg, /<text x="307" y="84"[^>]*>TOKENS<\/text>/);
		assert.match(svg, /<text x="390" y="84" text-anchor="end"[^>]*>128\.40K<\/text>/);
		assert.match(svg, /<text x="407" y="84"[^>]*>UPDATED<\/text>/);
		assert.match(svg, /<text x="490" y="84" text-anchor="end"[^>]*>14m<\/text>/);
		assert.match(svg, /<line x1="500" y1="74" x2="500" y2="86"/);
		assert.match(svg, /<text x="507" y="84"[^>]*>COST<\/text>/);
		assert.match(svg, /<text x="590" y="84" text-anchor="end"[^>]*font-size="11"[^>]*>\$0\.005<\/text>/);
		assert.match(svg, /x1="600" y1="0" x2="600" y2="100" stroke="#C8D0C8" stroke-width="1\.5"/);
		assert.doesNotMatch(svg, /\{\{|undefined/);
	});

	it("formats token totals compactly", () => {
		assert.equal(formatCompactTokens(undefined), "—");
		assert.equal(formatCompactTokens(999), "999");
		assert.equal(formatCompactTokens(1_250), "1.25K");
		assert.equal(formatCompactTokens(128_400), "128.40K");
		assert.equal(formatCompactTokens(1_250_000), "1.25M");
		assert.equal(formatCompactTokens(7_359_999), "7.35M");
	});

	it("pads costs to a consistent compact footprint without changing precision", () => {
		assert.equal(formatUsageCost(undefined), "—");
		assert.equal(formatUsageCost("$0.01"), "$0.010");
		assert.equal(formatUsageCost("$1.23"), "$1.230");
		assert.equal(formatUsageCost("$12.34"), "$12.34");
		assert.equal(formatUsageCost("$0.0001"), "$0.0001");
	});

	it("preserves a four-decimal cost at the fixed metadata font size", () => {
		const thread = createThread({ usageCost: "$0.0001" });
		const focused = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			now,
		});

		assert.match(focused, /<text x="590" y="84" text-anchor="end"[^>]*font-size="11"[^>]*>\$0\.0001<\/text>/);
	});

	it("escapes thread-provided text and keeps the empty state renderable", () => {
		const thread = createThread({ project: "<project>", title: `Review <this> & "that"` });
		const focused = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			now,
		});
		const empty = renderEncoderEmptySurfaceSvg(emptyTemplate, {
			connection: "offline",
			threads: [],
		});

		assert.match(focused, /&lt;PROJECT&gt;/);
		assert.match(focused, /Review &lt;this&gt; &amp; &quot;that&quot;/);
		assert.match(empty, /AMP CLI OFFLINE/);
		assert.match(empty, /Retrying automatically · check amp top/);
		assert.doesNotMatch(empty, /\{\{|undefined/);
	});

	it("bounds long project names and labels executor availability clearly", () => {
		const thread = createThread({
			project: "a".repeat(100),
			executorConnected: true,
		});
		const focused = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			now,
		});

		assert.match(focused, new RegExp(`${"A".repeat(63)}…`));
		assert.match(focused, />EXECUTOR CONNECTED<\/text>/);
		assert.doesNotMatch(focused, new RegExp("A".repeat(65)));
	});

	it("uses compact right-aligned fallbacks for missing metadata", () => {
		const thread = createThread({ updatedAt: "invalid", usageCost: "$1234567890" });
		const focused = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			now,
		});

		assert.match(focused, /<text x="490" y="84" text-anchor="end"[^>]*>—<\/text>/);
		assert.match(focused, /<text x="590" y="84" text-anchor="end"[^>]*font-size="11"[^>]*>\$12345…<\/text>/);
	});

	it("falls back when project metadata is blank", () => {
		const thread = createThread({ project: " " });
		const focused = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			now,
		});

		assert.match(focused, />AMP THREAD<\/text>/);
	});

	it("uses the black morphing-dot indicator for working and shipping activity", () => {
		const thread = createThread({ working: true, executorConnected: true });
		const focused = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 8,
			position: "1/1",
			now,
		});

		assert.match(focused, /data-busy-indicator="morphing-dots"/);
		assert.match(focused, /data-busy-frame="8"/);
		assert.match(focused, /fill="#0B0D0B"/);
		assert.match(focused, /Planning or using tools/);
		assert.doesNotMatch(focused, /stroke-dasharray/);
	});
});

function createThread(overrides: Partial<AmpTopThread> = {}): AmpTopThread {
	return {
		id: "T-thread",
		title: "Thread",
		working: false,
		executorConnected: false,
		...overrides,
	};
}
