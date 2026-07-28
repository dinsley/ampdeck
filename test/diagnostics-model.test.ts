import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	classifyDiagnosticError,
	commandAvailability,
	formatDiagnosticsReport,
} from "../src/diagnostics/diagnostics-model.ts";

describe("diagnostic error classification", () => {
	it("distinguishes safe support categories without echoing raw errors", () => {
		assert.equal(classifyDiagnosticError(new Error("spawn amp ENOENT")).kind, "missing-cli");
		assert.equal(
			classifyDiagnosticError(new Error("authentication failed for secret@example.test")).kind,
			"authentication",
		);
		assert.equal(classifyDiagnosticError(new Error("command timed out")).kind, "timeout");
		assert.equal(classifyDiagnosticError(new Error("schema mismatch")).kind, "schema-mismatch");
		assert.equal(classifyDiagnosticError(new Error("unknown command top")).kind, "incompatible");
		assert.equal(classifyDiagnosticError(new Error("network unavailable")).kind, "transient");
		assert.doesNotMatch(
			classifyDiagnosticError(new Error("authentication failed for secret@example.test")).message,
			/secret@example/u,
		);
	});
});

describe("diagnostics report", () => {
	it("is bounded, one-line-per-field, and contains only supplied safe fields", () => {
		const report = formatDiagnosticsReport([
			["Status", "live\nunsafe continuation"],
			["Large", "x".repeat(10_000)],
		]);
		assert.ok(report.length <= 8_193);
		assert.match(report, /Status: live unsafe continuation/u);
		assert.doesNotMatch(report, /T-secret|\/Users\//u);
	});

	it("explains command gating", () => {
		assert.deepEqual(commandAvailability({ connection: "offline", threads: [] }, undefined), {
			enabled: false,
			state: "disabled",
			reason: "Amp status is offline.",
		});
		assert.equal(
			commandAvailability(
				{ connection: "live", threads: [] },
				{ id: "T-safe", title: "Safe", working: false, executorConnected: true },
			).enabled,
			true,
		);
	});
});
