import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { JsonlLineBuffer, parseSnapshot } from "../src/amp/amp-top-model.ts";

const validThread = {
	id: "T-one",
	title: "One",
	working: false,
	executorConnected: true,
};

describe("experimental amp top schema", () => {
	it("accepts the complete safety contract", () => {
		const snapshot = parseSnapshot(JSON.stringify({ reconnecting: false, threads: [validThread] }));
		assert.equal(snapshot?.connection, "live");
		assert.deepEqual(
			snapshot?.threads.map(({ id, title, working, executorConnected }) => ({
				id,
				title,
				working,
				executorConnected,
			})),
			[validThread],
		);
	});

	it("fails closed when a root or thread safety field is absent or mistyped", () => {
		for (const value of [
			{ threads: [validThread] },
			{ reconnecting: "false", threads: [validThread] },
			{ reconnecting: false, threads: [{ ...validThread, working: undefined }] },
			{ reconnecting: false, threads: [{ ...validThread, working: "false" }] },
			{ reconnecting: false, threads: [{ ...validThread, executorConnected: undefined }] },
			{ reconnecting: false, threads: [{ ...validThread, executorConnected: 1 }] },
		]) {
			assert.equal(parseSnapshot(JSON.stringify(value)), undefined);
		}
	});

	it("rejects the whole snapshot when any row is malformed", () => {
		assert.equal(
			parseSnapshot(JSON.stringify({ reconnecting: false, threads: [validThread, { id: "T-unsafe" }] })),
			undefined,
		);
	});
});

describe("amp top JSONL buffering", () => {
	it("handles chunked CRLF records and multiple records per chunk", () => {
		const buffer = new JsonlLineBuffer();
		assert.deepEqual(buffer.push('{"one":1}\r'), []);
		assert.deepEqual(buffer.push('\n{"two":2}\npart'), [
			{ kind: "line", line: '{"one":1}' },
			{ kind: "line", line: '{"two":2}' },
		]);
		assert.deepEqual(buffer.push("ial"), []);
		assert.equal(buffer.finish(), "partial");
	});

	it("bounds oversized records and resumes at the next record", () => {
		const buffer = new JsonlLineBuffer();
		assert.deepEqual(buffer.push("x".repeat(1024 * 1024 + 1)), [{ kind: "oversized" }]);
		assert.deepEqual(buffer.push('\n{"safe":true}\n'), [{ kind: "line", line: '{"safe":true}' }]);
		assert.equal(buffer.finish(), undefined);
	});

	it("preserves valid and oversized record ordering", () => {
		const oversized = "x".repeat(1024 * 1024 + 1);
		const first = new JsonlLineBuffer();
		assert.deepEqual(first.push(`safe\n${oversized}\n`), [{ kind: "line", line: "safe" }, { kind: "oversized" }]);
		const second = new JsonlLineBuffer();
		assert.deepEqual(second.push(`${oversized}\nsafe\n`), [{ kind: "oversized" }, { kind: "line", line: "safe" }]);
	});
});
