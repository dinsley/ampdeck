import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseThreadSearchIds, parseThreadUsageCost } from "../src/amp/amp-command.ts";

describe("Amp CLI output", () => {
	it("extracts the display cost from thread usage output", () => {
		assert.equal(parseThreadUsageCost("$0.98\nDetails: https://ampcode.com/threads/T-example/usage\n"), "$0.98");
		assert.equal(parseThreadUsageCost("€ 12.34\r\nDetails follow\r\n"), "€ 12.34");
	});

	it("ignores output without a display cost", () => {
		assert.equal(parseThreadUsageCost("Thread usage is unavailable\n"), undefined);
	});

	it("extracts thread IDs from JSON search results", () => {
		assert.deepEqual(parseThreadSearchIds('[{"id":"T-one"},{"id":"T-two"},{"title":"missing"}]'), new Set(["T-one", "T-two"]));
		assert.deepEqual(parseThreadSearchIds("not json"), new Set());
	});
});
