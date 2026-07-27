import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	isAcceptedUserRecord,
	launchAmpCommand,
	parseThreadSearchIds,
	parseThreadUsageCost,
	resolveAmpCommand,
} from "../src/amp/amp-command.ts";

describe("Amp CLI resolution", () => {
	it("finds the default installation outside PATH on macOS and Linux", () => {
		for (const platform of ["darwin", "linux"] as const) {
			const expected = join("/Users/example", ".amp", "bin", "amp");
			assert.equal(
				resolveAmpCommand(platform, "/Users/example", (path) => path === expected),
				expected,
			);
		}
	});

	it("uses the Windows executable name", () => {
		const home = String.raw`C:\Users\example`;
		const expected = join(home, ".amp", "bin", "amp.exe");
		assert.equal(
			resolveAmpCommand("win32", home, (path) => path === expected),
			expected,
		);
	});

	it("falls back to PATH when the default installation is absent", () => {
		assert.equal(
			resolveAmpCommand("darwin", "/Users/example", () => false),
			"amp",
		);
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
		assert.deepEqual(parseThreadSearchIds('[{"id":"T-one"},{"id":"T-two"}]'), new Set(["T-one", "T-two"]));
		assert.deepEqual(parseThreadSearchIds("[]"), new Set());
	});

	it("distinguishes malformed search output from an authoritative empty result", () => {
		assert.equal(parseThreadSearchIds("not json"), undefined);
		assert.equal(parseThreadSearchIds('{"id":"T-one"}'), undefined);
		assert.equal(parseThreadSearchIds('[{"id":"T-one"},{"title":"missing"}]'), undefined);
	});

	it("recognizes only a streamed user acknowledgement for the expected thread", () => {
		assert.equal(isAcceptedUserRecord('{"type":"user","session_id":"T-one"}', "T-one"), true);
		assert.equal(isAcceptedUserRecord('{"type":"system","session_id":"T-one"}', "T-one"), false);
		assert.equal(isAcceptedUserRecord('{"type":"user","session_id":"T-other"}', "T-one"), false);
		assert.equal(isAcceptedUserRecord("malformed", "T-one"), false);
	});
});

describe("detached Amp command lifecycle", () => {
	it("rejects a spawn failure", async () => {
		await assert.rejects(
			launchAmpCommand([], "T-one", {
				command: "/definitely/missing/ampdeck-command",
				appendStreamJson: false,
				timeoutMs: 1_000,
			}),
			/ENOENT/,
		);
	});

	it("reports stderr from an immediate nonzero exit", async () => {
		await assert.rejects(
			launchNodeScript('process.stderr.write("authentication failed"); process.exit(2)'),
			/authentication failed/,
		);
	});

	it("resolves only after the expected user acknowledgement", async () => {
		await launchNodeScript(
			'process.stdout.write("{\\\"type\\\":\\\"system\\\",\\\"session_id\\\":\\\"T-one\\\"}\\n");' +
				'setTimeout(() => process.stdout.write("{\\\"type\\\":\\\"user\\\",\\\"session_id\\\":\\\"T-one\\\"}\\n"), 10)',
		);
	});

	it("times out when no acknowledgement arrives", async () => {
		await assert.rejects(launchNodeScript("setTimeout(() => {}, 1000)", 20), /did not acknowledge/);
	});
});

function launchNodeScript(script: string, timeoutMs = 1_000): Promise<void> {
	return launchAmpCommand(["-e", script], "T-one", {
		command: process.execPath,
		appendStreamJson: false,
		timeoutMs,
	});
}
