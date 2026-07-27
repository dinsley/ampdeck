import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AmpTopThread } from "../src/amp/amp-top-model.ts";
import { getDisplayModel } from "../src/model/thread-status.ts";
import { renderEncoderEmptySurfaceSvg, renderEncoderFocusSurfaceSvg } from "../src/rendering/encoder-surface.ts";

const focusTemplate = readFileSync(new URL("../src/assets/encoder-focus.svg", import.meta.url), "utf8");
const emptyTemplate = readFileSync(new URL("../src/assets/encoder-empty.svg", import.meta.url), "utf8");
const now = Date.parse("2026-07-26T12:00:00Z");

describe("encoder surface rendering", () => {
	it("renders updated and cost metadata as separate fixed-position groups", () => {
		const thread = createThread({
			project: "ampdeck",
			title: "AmpDeck code review",
			updatedAt: new Date(now - 2 * 60 * 60_000).toISOString(),
			usageCost: "$0.97",
		});
		const svg = renderEncoderFocusSurfaceSvg(focusTemplate, {
			thread,
			model: getDisplayModel(thread),
			animationFrame: 0,
			position: "1/1",
			phase: { current: "DONE", startedAt: now - 5 * 60_000 },
			now,
		});

		assert.match(svg, />UPDATED<\/text>/);
		assert.match(svg, />2h<\/text>/);
		assert.match(svg, />COST<\/text>/);
		assert.match(svg, />\$0\.97<\/text>/);
		assert.doesNotMatch(svg, /\{\{|undefined/);
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
		assert.doesNotMatch(empty, /\{\{|undefined/);
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
