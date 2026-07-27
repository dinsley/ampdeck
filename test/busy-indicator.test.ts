import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	busyIndicatorFrameDurationMs,
	getBusyIndicatorFrameCount,
	renderBusyIndicator,
} from "../src/rendering/busy-indicator.ts";

describe("busy indicator rendering", () => {
	const options = {
		centerX: 72,
		centerY: 68,
		dotRadius: 3.4,
		gap: 10,
		color: "#0B0D0B",
	};

	it("renders a black morphing-dot frame without SVG animation dependencies", () => {
		const svg = renderBusyIndicator({ ...options, frame: 3 });

		assert.match(svg, /data-busy-indicator="morphing-dots"/);
		assert.match(svg, /data-busy-frame="3"/);
		assert.match(svg, /fill="#0B0D0B"/);
		assert.doesNotMatch(svg, /rotate|animate|stroke-dasharray/);
		assert.equal(busyIndicatorFrameDurationMs, 500);
	});

	it("cycles deterministically and keeps negative frame values valid", () => {
		const frameCount = getBusyIndicatorFrameCount();
		const first = renderBusyIndicator({ ...options, frame: 0 });
		const wrapped = renderBusyIndicator({ ...options, frame: frameCount });
		const previous = renderBusyIndicator({ ...options, frame: -1 });

		assert.equal(frameCount, 14);
		assert.equal(first, wrapped);
		assert.match(previous, new RegExp(`data-busy-frame="${frameCount - 1}"`));
		assert.notEqual(first, previous);
	});

	it("holds a six-dot grid with two dots on each of three lines", () => {
		for (const frame of [8, 9, 10]) {
			const svg = renderBusyIndicator({ ...options, frame });

			assert.match(svg, new RegExp(`data-busy-frame="${frame}"`));
			assert.match(svg, /data-busy-dot-count="6"/);
			for (const y of [58, 68, 78]) {
				assert.match(svg, new RegExp(`cy="${y}"`));
			}
		}
	});
});
