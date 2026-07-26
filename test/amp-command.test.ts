import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseThreadSearchIds, parseThreadUsageCost, resolveAmpCommand } from "../src/amp/amp-command.ts";

describe("Amp CLI resolution", () => {
	it("finds the default installation outside PATH on macOS and Linux", () => {
		for (const platform of ["darwin", "linux"] as const) {
			const expected = join("/Users/example", ".amp", "bin", "amp");
			assert.equal(resolveAmpCommand(platform, "/Users/example", (path) => path === expected), expected);
		}
	});

	it("uses the Windows executable name", () => {
		const home = String.raw`C:\Users\example`;
		const expected = join(home, ".amp", "bin", "amp.exe");
		assert.equal(resolveAmpCommand("win32", home, (path) => path === expected), expected);
	});

	it("falls back to PATH when the default installation is absent", () => {
		assert.equal(resolveAmpCommand("darwin", "/Users/example", () => false), "amp");
	});
});

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
