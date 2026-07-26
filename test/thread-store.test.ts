import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reachedUsageBoundary } from "../src/actions/encoder-status-model.ts";
import type { AmpTopSnapshot, AmpTopThread } from "../src/amp/amp-top-source.ts";
import { ThreadStore } from "../src/state/thread-store.ts";

describe("thread usage refresh boundaries", () => {
	it("detects completion reported by amp top", () => {
		assert.equal(reachedUsageBoundary(thread({ working: true }), thread({ working: false })), true);
	});

	it("does not refresh for ordinary updates, startup, or a different thread", () => {
		assert.equal(reachedUsageBoundary(thread(), thread()), false);
		assert.equal(reachedUsageBoundary(undefined, thread()), false);
		assert.equal(reachedUsageBoundary(thread(), thread({ id: "T-other" })), false);
	});
});

describe("thread usage cache", () => {
	it("keeps a completed usage result when selection changes in flight", async () => {
		const source = new FakeTopSource();
		const usageRequests = new Map<string, Deferred<string>>();
		const store = new ThreadStore(source, async (args) => {
			const threadId = args.at(-1);
			assert.ok(threadId);
			const request = deferred<string>();
			usageRequests.set(threadId, request);
			return request.promise;
		});
		source.emit({ connection: "live", threads: [thread({ id: "T-one" }), thread({ id: "T-two" })] });

		store.selectThread("T-one");
		store.selectThread("T-two");
		usageRequests.get("T-one")?.resolve("$1.23\n");
		await until(() => usageRequests.has("T-two"));

		assert.equal(store.snapshot.threads.find(({ id }) => id === "T-one")?.usageCost, "$1.23");

		usageRequests.get("T-two")?.resolve("$4.56\n");
		await until(() => store.snapshot.threads.find(({ id }) => id === "T-two")?.usageCost === "$4.56");
		assert.deepEqual(
			store.snapshot.threads.map(({ usageCost }) => usageCost),
			["$1.23", "$4.56"],
		);
		store.dispose();
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

class FakeTopSource {
	private listener: ((snapshot: AmpTopSnapshot) => void) | undefined;

	onSnapshot(listener: (snapshot: AmpTopSnapshot) => void): void {
		this.listener = listener;
		listener({ connection: "connecting", threads: [] });
	}

	start(): void {}

	stop(): void {}

	emit(snapshot: AmpTopSnapshot): void {
		this.listener?.(snapshot);
	}
}

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve: Deferred<T>["resolve"] = () => undefined;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.fail("Condition was not reached");
}
