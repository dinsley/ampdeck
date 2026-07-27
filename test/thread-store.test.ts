import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AmpTopSnapshot } from "../src/amp/amp-top-source.ts";
import type { AmpTopThread } from "../src/amp/amp-top-model.ts";
import { reachedUsageBoundary } from "../src/model/thread-status.ts";
import { ThreadStore } from "../src/state/thread-store.ts";
import { ShippingLifecycle, ThreadActionGate, type ShippingDispatchState } from "../src/state/thread-store-model.ts";

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
		const store = new ThreadStore({
			source,
			runCommand: async (args) => {
				if (args.includes("list")) return "[]";
				const threadId = args.at(-1);
				assert.ok(threadId);
				const request = deferred<string>();
				usageRequests.set(threadId, request);
				return request.promise;
			},
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
		const store = new ThreadStore({
			source,
			runCommand: (args) => {
				if (args.includes("list")) return Promise.resolve("[]");
				const threadId = args.at(-1);
				assert.ok(threadId);
				usageThreadIds.push(threadId);
				return Promise.resolve("$1.23\n");
			},
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

describe("thread metadata reconciliation", () => {
	it("backfills missing metadata without replacing amp top state", async () => {
		const source = new FakeTopSource();
		const store = new ThreadStore({
			source,
			runCommand: (args, timeoutMs) => {
				assert.deepEqual(args, ["--no-color", "threads", "list", "--json", "--limit", "100"]);
				assert.equal(timeoutMs, 5_000);
				return Promise.resolve(
					JSON.stringify([
						{
							id: "T-thread",
							title: "Theia UI/UX tickets",
							tree: "file:///Users/dinsley/Projects/personal/theia",
							updated: "2026-07-27T12:00:00.000Z",
						},
						{
							id: "T-not-active",
							title: "Archived thread",
							tree: "file:///Users/dinsley/Projects/personal/archive",
						},
					]),
				);
			},
		});
		const release = store.acquire();
		source.emit({
			connection: "live",
			threads: [thread({ title: "T-thread", working: true, executorConnected: false })],
		});
		await until(() => store.snapshot.threads[0]?.project === "theia");

		assert.deepEqual(store.snapshot.threads, [
			{
				...thread({
					title: "Theia UI/UX tickets",
					project: "theia",
					updatedAt: "2026-07-27T12:00:00.000Z",
					working: true,
					executorConnected: false,
				}),
				usageCost: undefined,
				phase: undefined,
			},
		]);
		release();
		store.dispose();
	});

	it("prefers nonblank live metadata from amp top", async () => {
		const source = new FakeTopSource();
		const store = new ThreadStore({
			source,
			runCommand: () =>
				Promise.resolve(
					JSON.stringify([
						{
							id: "T-thread",
							title: "Stale title",
							tree: "file:///workspace/stale",
							updated: "2026-07-26T12:00:00.000Z",
						},
					]),
				),
		});
		const release = store.acquire();
		source.emit({
			connection: "live",
			threads: [
				thread({
					title: "Live title",
					project: "current",
					updatedAt: "2026-07-27T12:00:00.000Z",
				}),
			],
		});
		await until(() => store.snapshot.threads[0]?.project === "current");

		assert.equal(store.snapshot.threads[0]?.title, "Live title");
		assert.equal(store.snapshot.threads[0]?.project, "current");
		assert.equal(store.snapshot.threads[0]?.updatedAt, "2026-07-27T12:00:00.000Z");
		release();
		store.dispose();
	});

	it("prunes completed top entries absent from a complete inventory", async () => {
		const source = new FakeTopSource();
		const inventory = deferred<string>();
		const store = new ThreadStore({
			source,
			runCommand: (args) => {
				if (args.includes("list")) return inventory.promise;
				return Promise.resolve("$0.01\n");
			},
		});
		const release = store.acquire();
		source.emit({
			connection: "live",
			threads: [
				thread({ id: "T-gone", title: "Theia UI/UX tickets", executorConnected: false }),
				thread({ id: "T-working", working: true, executorConnected: false }),
				thread({ id: "T-connected", executorConnected: true }),
			],
		});
		store.selectThread("T-gone");
		inventory.resolve("[]");
		await until(() => store.snapshot.threads.every(({ id }) => id !== "T-gone"));

		assert.deepEqual(
			store.snapshot.threads.map(({ id }) => id),
			["T-working", "T-connected"],
		);
		assert.equal(store.selectedThreadId, undefined);
		release();
		store.dispose();
	});

	it("does not prune from a potentially truncated inventory", async () => {
		const source = new FakeTopSource();
		const store = new ThreadStore({
			source,
			runCommand: () =>
				Promise.resolve(
					JSON.stringify(
						Array.from({ length: 100 }, (_, index) => ({
							id: `T-inventory-${index}`,
						})),
					),
				),
		});
		const release = store.acquire();
		source.emit({
			connection: "live",
			threads: [thread({ id: "T-not-on-first-page", executorConnected: false })],
		});
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(store.snapshot.threads[0]?.id, "T-not-on-first-page");
		release();
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

	it("restores a persisted workflow until its working transition completes", () => {
		const lifecycle = new ShippingLifecycle();
		lifecycle.restore([{ threadId: "T-thread", observedWorking: true, expiresAt: 0 }]);
		assert.equal(lifecycle.isShipping(thread({ working: true })), true);
		lifecycle.reconcile([thread({ working: false })]);
		assert.equal(lifecycle.isShipping(thread()), false);
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

	it("reports the next unstarted dispatch expiry", () => {
		const lifecycle = new ShippingLifecycle(100);
		lifecycle.markDispatched("T-one", 10);
		lifecycle.markDispatched("T-two", 20);
		assert.equal(lifecycle.nextExpiry(), 110);
		lifecycle.reconcile([thread({ id: "T-one", working: true }), thread({ id: "T-two" })], 30);
		assert.equal(lifecycle.nextExpiry(), 120);
	});
});

describe("persisted shipping state", () => {
	it("expires a dispatch without requiring another Amp snapshot", async () => {
		const source = new FakeTopSource();
		const persistence = new MemoryShippingPersistence();
		const store = new ThreadStore({ source, shippingPersistence: persistence, shippingStartTimeoutMs: 20 });
		const release = store.acquire();
		source.emit({ connection: "live", threads: [thread()] });

		store.markShippingDispatched("T-thread");
		assert.equal(store.snapshot.threads[0]?.phase, "shipping");
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.equal(store.snapshot.threads[0]?.phase, undefined);
		await until(() => persistence.dispatches.length === 0);

		release();
		store.dispose();
	});

	it("restores a started workflow and clears it after completion", async () => {
		const persistence = new MemoryShippingPersistence([
			{ threadId: "T-thread", observedWorking: true, expiresAt: Date.now() - 1 },
		]);
		const source = new FakeTopSource();
		const store = new ThreadStore({ source, shippingPersistence: persistence });
		const release = store.acquire();
		source.emit({ connection: "live", threads: [thread({ working: true })] });
		await until(() => store.snapshot.threads[0]?.phase === "shipping");

		source.emit({ connection: "live", threads: [thread({ working: false })] });
		await until(() => persistence.dispatches.length === 0);
		assert.equal(store.snapshot.threads[0]?.phase, undefined);

		release();
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

class MemoryShippingPersistence {
	constructor(public dispatches: ShippingDispatchState[] = []) {}

	load(): Promise<ShippingDispatchState[]> {
		return Promise.resolve(this.dispatches.map((dispatch) => ({ ...dispatch })));
	}

	save(dispatches: ShippingDispatchState[]): Promise<void> {
		this.dispatches = dispatches.map((dispatch) => ({ ...dispatch }));
		return Promise.resolve();
	}
}

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
