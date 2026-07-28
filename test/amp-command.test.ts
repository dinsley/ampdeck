import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import { describe, it } from "node:test";

import {
	isAcceptedUserRecord,
	launchAmpCommand,
	parseAmpVersion,
	parseThreadExportDetails,
	parseThreadUsageCost,
	resolveAmpCommand,
} from "../src/amp/amp-command.ts";

describe("Amp CLI resolution", () => {
	it("finds the default installation outside PATH on macOS and Linux", () => {
		for (const platform of ["darwin", "linux"] as const) {
			const expected = posix.join("/Users/example", ".amp", "bin", "amp");
			assert.equal(
				resolveAmpCommand(platform, "/Users/example", (path) => path === expected),
				expected,
			);
		}
	});

	it("uses the Windows executable name", () => {
		const home = String.raw`C:\Users\example`;
		const expected = win32.join(home, ".amp", "bin", "amp.exe");
		assert.equal(
			resolveAmpCommand("win32", home, (path) => path === expected),
			expected,
		);
	});

	it("finds Homebrew installations outside the GUI application PATH on macOS", () => {
		for (const expected of ["/opt/homebrew/bin/amp", "/usr/local/bin/amp"]) {
			assert.equal(
				resolveAmpCommand("darwin", "/Users/example", (path) => path === expected),
				expected,
			);
		}
	});

	it("finds conventional user and system installations on Linux", () => {
		for (const expected of [
			"/home/example/.local/bin/amp",
			"/home/linuxbrew/.linuxbrew/bin/amp",
			"/usr/local/bin/amp",
			"/usr/bin/amp",
		]) {
			assert.equal(
				resolveAmpCommand("linux", "/home/example", (path) => path === expected),
				expected,
			);
		}
	});

	it("falls back to PATH when the default installation is absent", () => {
		assert.equal(
			resolveAmpCommand("darwin", "/Users/example", () => false),
			"amp",
		);
	});
});

describe("Amp CLI output", () => {
	it("extracts a bounded semantic version", () => {
		assert.equal(parseAmpVersion("amp 1.2.3\n"), "1.2.3");
		assert.equal(parseAmpVersion("unexpected"), undefined);
	});

	it("extracts the display cost from thread usage output", () => {
		assert.equal(parseThreadUsageCost("$0.98\nDetails: https://ampcode.com/threads/T-example/usage\n"), "$0.98");
		assert.equal(parseThreadUsageCost("€ 12.34\r\nDetails follow\r\n"), "€ 12.34");
	});

	it("ignores output without a display cost", () => {
		assert.equal(parseThreadUsageCost("Thread usage is unavailable\n"), undefined);
	});

	it("aggregates input, cache, and output tokens from a sanitized thread export", () => {
		assert.deepEqual(
			parseThreadExportDetails(
				JSON.stringify({
					meta: { executorType: "sandbox" },
					messages: [
						{
							usage: {
								inputTokens: 100,
								cacheCreationInputTokens: 20,
								cacheReadInputTokens: 30,
								outputTokens: 50,
							},
						},
						{ usage: { totalInputTokens: 300, inputTokens: 999, outputTokens: 75 } },
					],
				}),
			),
			{ executionOrigin: "orb", tokensUsed: 575 },
		);
	});

	it("maps observed executor origins and rejects malformed exports", () => {
		assert.equal(parseThreadExportDetails("not json"), undefined);
		for (const [executorType, executionOrigin] of [
			["local-client", "cli"],
			["sandbox", "orb"],
			["virtual", "virtual"],
			["future-value", "unknown"],
		] as const) {
			assert.deepEqual(parseThreadExportDetails(JSON.stringify({ meta: { executorType }, messages: [] })), {
				executionOrigin,
				tokensUsed: undefined,
			});
		}
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
