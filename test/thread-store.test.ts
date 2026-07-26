import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AmpTopThread } from "../src/amp/amp-top-source.ts";
import { reachedUsageBoundary } from "../src/actions/encoder-status-model.ts";

describe("thread usage refresh boundaries", () => {
	it("detects completion reported by amp top", () => {
		assert.equal(reachedUsageBoundary(thread({ working: true }), thread({ working: false })), true);
	});

	it("detects completion and pauses reported by the companion", () => {
		assert.equal(reachedUsageBoundary(thread({ companionState: "running" }), thread({ companionState: "done" })), true);
		assert.equal(
			reachedUsageBoundary(thread({ companionState: "running" }), thread({ companionState: "awaiting-approval" })),
			true,
		);
	});

	it("does not refresh for ordinary updates, startup, or a different thread", () => {
		assert.equal(reachedUsageBoundary(thread(), thread()), false);
		assert.equal(reachedUsageBoundary(undefined, thread()), false);
		assert.equal(reachedUsageBoundary(thread(), thread({ id: "T-other" })), false);
	});
});

function thread(overrides: Partial<AmpTopThread> = {}): AmpTopThread {
	return {
		id: "T-thread",
		title: "Thread",
		working: false,
		executorConnected: true,
		...overrides,
	};
}
