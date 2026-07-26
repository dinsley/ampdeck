import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AmpTopThread } from "../src/amp/amp-top-source.ts";
import {
	chooseFocusedThread,
	orderThreadsByAttention,
	splitTitle,
	updatePhaseMetadata,
	type PhaseMetadata,
} from "../src/actions/encoder-status-model.ts";

const now = Date.parse("2026-07-26T12:00:00Z");

describe("encoder status model", () => {
	it("orders attention states while preserving inventory order within a rank", () => {
		const threads = [
			thread("idle-a"),
			thread("running-a", { working: true }),
			thread("idle-b"),
			thread("shipping", { phase: "shipping" }),
			thread("running-b", { working: true }),
		];

		assert.deepEqual(
			orderThreadsByAttention(threads).map(({ id }) => id),
			["shipping", "running-a", "running-b", "idle-a", "idle-b"],
		);
	});

	it("keeps a valid current focus and falls back to the highest-priority thread", () => {
		const threads = [thread("idle"), thread("shipping", { phase: "shipping" })];
		assert.equal(chooseFocusedThread(threads, undefined, "idle")?.id, "idle");
		assert.equal(chooseFocusedThread(threads, undefined, "archived")?.id, "shipping");
		assert.equal(chooseFocusedThread(threads, "shipping", "idle")?.id, "shipping");
	});

	it("tracks the current phase, resets duration, and prunes removed threads", () => {
		const metadata = new Map<string, PhaseMetadata>();
		updatePhaseMetadata(
			metadata,
			[
				{ id: "one", status: "THINKING" },
				{ id: "removed", status: "IDLE" },
			],
			100,
		);
		updatePhaseMetadata(metadata, [{ id: "one", status: "EDITING" }], 200);
		updatePhaseMetadata(metadata, [{ id: "one", status: "TESTING" }], 300);
		updatePhaseMetadata(metadata, [{ id: "one", status: "DONE" }], 400);

		assert.equal(metadata.has("removed"), false);
		assert.deepEqual(metadata.get("one"), {
			current: "DONE",
			startedAt: 400,
		});
	});

	it("splits long titles into at most two bounded lines", () => {
		assert.deepEqual(splitTitle("Short title"), ["Short title"]);
		const lines = splitTitle(
			"Implement a durable and privacy-preserving Stream Deck status display for all active Amp threads with useful context",
		);
		assert.equal(lines.length, 2);
		assert.ok(lines.every((line) => line.length <= 53));
	});
});

function thread(id: string, overrides: Partial<AmpTopThread> = {}): AmpTopThread {
	return {
		id,
		title: id,
		working: false,
		executorConnected: true,
		updatedAt: new Date(now - 60_000).toISOString(),
		...overrides,
	};
}
