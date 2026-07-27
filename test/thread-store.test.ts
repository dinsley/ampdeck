import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AmpTopSnapshot } from "../src/amp/amp-top-source.ts";
import type { AmpTopThread } from "../src/amp/amp-top-model.ts";
import { reachedUsageBoundary } from "../src/model/thread-status.ts";
import { ThreadStore } from "../src/state/thread-store.ts";
import { ShippingLifecycle, ThreadActionGate } from "../src/state/thread-store-model.ts";

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
			if (args.includes("search")) return "[]";
			const threadId = args.at(-1);
			assert.ok(threadId);
			const request = deferred<string>();
			usageRequests.set(threadId, request);
			return request.promise;
		});
		const release = store.acquire();
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
		release();
		store.dispose();
	});

	it("does not run supplementary CLI queries without a visible action", async () => {
		const source = new FakeTopSource();
		const usageThreadIds: string[] = [];
		const store = new ThreadStore(source, (args) => {
			if (args.includes("search")) return Promise.resolve("[]");
			const threadId = args.at(-1);
			assert.ok(threadId);
			usageThreadIds.push(threadId);
			return Promise.resolve("$1.23\n");
		});
		source.emit({ connection: "live", threads: [thread({ id: "T-one" }), thread({ id: "T-two" })] });

		store.selectThread("T-one");
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(usageThreadIds, []);

		const release = store.acquire();
		await until(() => usageThreadIds.length === 1);
		release();

		store.selectThread("T-two");
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(usageThreadIds, ["T-one"]);
		store.dispose();
	});
});

describe("shared per-thread action gate", () => {
	it("atomically excludes concurrent action types and releases after failure", () => {
		const gate = new ThreadActionGate();
		assert.equal(gate.tryAcquire("T-thread", 0), true);
		assert.equal(gate.tryAcquire("T-thread", 0), false);
		assert.equal(gate.tryAcquire("T-other", 0), true);
		gate.release("T-thread", 0, 0);
		assert.equal(gate.tryAcquire("T-thread", 0), true);
	});

	it("holds a shared cooldown after successful dispatch", () => {
		const gate = new ThreadActionGate();
		assert.equal(gate.tryAcquire("T-thread", 0), true);
		gate.release("T-thread", 10_000, 0);
		assert.equal(gate.tryAcquire("T-thread", 9_999), false);
		assert.equal(gate.tryAcquire("T-thread", 10_000), true);
	});
});

describe("shipping lifecycle", () => {
	it("marks dispatch immediately and clears after the working transition", () => {
		const lifecycle = new ShippingLifecycle();
		lifecycle.markDispatched("T-thread", 0);
		assert.equal(lifecycle.isShipping(thread()), true);
		lifecycle.reconcile([thread({ working: true })], 1);
		assert.equal(lifecycle.isShipping(thread({ working: true })), true);
		lifecycle.reconcile([thread({ working: false })], 2);
		assert.equal(lifecycle.isShipping(thread()), false);
	});

	it("keeps shipping through a non-authoritative reconnect gap", () => {
		const lifecycle = new ShippingLifecycle();
		lifecycle.markDispatched("T-thread", 0);
		lifecycle.reconcile([thread({ working: true })], 1);
		// ThreadStore intentionally does not reconcile connecting or offline snapshots.
		assert.equal(lifecycle.isShipping(thread()), true);
		lifecycle.reconcile([thread({ working: false })], 2);
		assert.equal(lifecycle.isShipping(thread()), false);
	});

	it("uses persistent labels only to recover an actively working workflow", () => {
		const lifecycle = new ShippingLifecycle();
		lifecycle.setLabels(new Set(["T-thread"]));
		assert.equal(lifecycle.isShipping(thread()), false);
		assert.equal(lifecycle.isShipping(thread({ working: true })), true);
	});

	it("expires a dispatch that never starts", () => {
		const lifecycle = new ShippingLifecycle(100);
		lifecycle.markDispatched("T-thread", 0);
		lifecycle.reconcile([thread()], 100);
		assert.equal(lifecycle.isShipping(thread()), false);
	});

	it("captures working that begins before command acknowledgement", () => {
		const lifecycle = new ShippingLifecycle();
		lifecycle.markDispatched("T-thread", 0, true);
		lifecycle.reconcile([thread({ working: false })], 1);
		assert.equal(lifecycle.isShipping(thread()), false);
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
