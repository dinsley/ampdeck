import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	renderCommandFeedbackSvg,
	renderCommandKeySvg,
	renderOpenThreadKeySvg,
} from "../src/rendering/command-surface.ts";
import { busyIndicatorFrameDurationMs } from "../src/rendering/busy-indicator.ts";

const commandTemplate = readFileSync(new URL("../src/assets/command-key.svg", import.meta.url), "utf8");
const feedbackTemplate = readFileSync(new URL("../src/assets/command-feedback.svg", import.meta.url), "utf8");
const openTemplate = readFileSync(new URL("../src/assets/open-thread-key.svg", import.meta.url), "utf8");

describe("command surface rendering", () => {
	it("renders explanatory unavailable states without replacing the action identity", () => {
		const svg = renderCommandKeySvg(
			commandTemplate,
			{
				label: "REVIEW",
				detail: "Review <unsafe> now",
				color: "#F34E3F",
				dimmed: true,
				footer: "NO EXECUTOR",
				icon: "review",
			},
			0,
		);

		assert.match(svg, />REVIEW<\/text>/);
		assert.match(svg, />NO EXECUTOR<\/text>/);
		assert.match(svg, /Review &lt;unsafe…<\/text>/);
		assert.doesNotMatch(svg, /\{\{|undefined/);
	});

	it("renders loading, open-thread, and temporary feedback templates completely", () => {
		const loading = renderCommandKeySvg(
			commandTemplate,
			{
				label: "SHIP",
				detail: "Thread",
				color: "#F34E3F",
				footer: "BUSY",
				loading: true,
				icon: "ship",
			},
			busyIndicatorFrameDurationMs * 6,
		);
		const open = renderOpenThreadKeySvg(openTemplate, { title: "Thread", dimmed: false });
		const feedback = renderCommandFeedbackSvg(feedbackTemplate, "sent");

		assert.match(loading, /data-busy-indicator="morphing-dots"/);
		assert.match(loading, /data-busy-frame="6"/);
		assert.match(loading, /fill="#0B0D0B"/);
		assert.doesNotMatch(loading, /rotate|stroke-dasharray/);
		assert.doesNotMatch(loading, />SHIP<\/text>/);
		assert.match(open, />OPEN<\/text>/);
		assert.match(feedback, />SENT<\/text>/);
		for (const svg of [loading, open, feedback]) assert.doesNotMatch(svg, /\{\{|undefined/);
	});
});
