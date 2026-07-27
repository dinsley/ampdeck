import { AmpTopSource, type AmpTopSnapshot, type AmpTopThread } from "../amp/amp-top-source";
import { parseThreadUsageCost, runAmpCommand } from "../amp/amp-command";
import { parseThreadMetadataList, type AmpThreadMetadata } from "../amp/amp-threads-model";
import { reachedUsageBoundary } from "../model/thread-status";
import { ShippingLifecycle, ThreadActionGate, type ShippingDispatchState } from "./thread-store-model";

type ThreadStoreListener = (snapshot: AmpTopSnapshot) => void;
type TopSource = Pick<AmpTopSource, "onSnapshot" | "start" | "stop">;

const usageRetryDelaysMs = [1_000, 5_000, 15_000];
const reconciliationIntervalMs = 60_000;
const reconciliationTimeoutMs = 5_000;
const reconciliationLimit = 100;

export type ShippingStatePersistence = {
	load(): Promise<ShippingDispatchState[]>;
	save(dispatches: ShippingDispatchState[]): Promise<void>;
};

type ThreadStoreOptions = {
	source?: TopSource;
	runCommand?: typeof runAmpCommand;
	shippingPersistence?: ShippingStatePersistence;
	shippingStartTimeoutMs?: number;
};

export class ThreadStore {
	private readonly actionCooldownTimers = new Map<string, NodeJS.Timeout>();
	private readonly actionGate = new ThreadActionGate();
	private readonly listeners = new Set<ThreadStoreListener>();
	private reconciliationInFlight = false;
	private reconciliationInventoryComplete = false;
	private reconciliationTimer: NodeJS.Timeout | undefined;
	private readonly threadMetadata = new Map<string, AmpThreadMetadata>();
	private readonly shippingLifecycle: ShippingLifecycle;
	private shippingExpiryTimer: NodeJS.Timeout | undefined;
	private shippingLoadPromise: Promise<void> | undefined;
	private shippingPersistenceQueue = Promise.resolve();
	private readonly shippingPersistence: ShippingStatePersistence | undefined;
	private readonly source: TopSource;
	private readonly runCommand: typeof runAmpCommand;
	private readonly usageCosts = new Map<string, string>();
	private usageInFlight = false;
	private usageRetryTimer: NodeJS.Timeout | undefined;
	private usageTimer: NodeJS.Timeout | undefined;
	private topSnapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };
	private users = 0;

	selectionRevision = 0;
	selectedThreadId: string | undefined;
	snapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };

	constructor(options: ThreadStoreOptions = {}) {
		this.source = options.source ?? new AmpTopSource();
		this.runCommand = options.runCommand ?? runAmpCommand;
		this.shippingPersistence = options.shippingPersistence;
		this.shippingLifecycle = new ShippingLifecycle(options.shippingStartTimeoutMs);
		this.source.onSnapshot((snapshot) => {
			const previous = this.selectedThread;
			const connectionBecameLive = this.topSnapshot.connection !== "live" && snapshot.connection === "live";
			if (snapshot.connection !== "live") this.reconciliationInventoryComplete = false;
			this.topSnapshot = snapshot;
			if (snapshot.connection === "live" && this.shippingLifecycle.reconcile(snapshot.threads)) {
				this.persistShippingState();
			}
			this.scheduleShippingExpiry();
			this.rebuildSnapshot();
			if (reachedUsageBoundary(previous, this.selectedThread)) this.scheduleUsageRetries();
			if (connectionBecameLive && this.users > 0) {
				void this.restoreShippingState();
				void this.refreshThreadMetadata();
			}
		});
	}

	get selectedThread(): AmpTopThread | undefined {
		return this.snapshot.threads.find((thread) => thread.id === this.selectedThreadId);
	}

	tryAcquireThreadAction(threadId: string): boolean {
		if (!this.actionGate.tryAcquire(threadId)) return false;
		this.notify();
		return true;
	}

	releaseThreadAction(threadId: string, cooldownMs = 0): void {
		this.actionGate.release(threadId, cooldownMs);
		const previousTimer = this.actionCooldownTimers.get(threadId);
		if (previousTimer) clearTimeout(previousTimer);
		if (cooldownMs > 0) {
			const timer = setTimeout(() => {
				this.actionCooldownTimers.delete(threadId);
				this.actionGate.clearCooldown(threadId);
				this.notify();
			}, cooldownMs);
			timer.unref();
			this.actionCooldownTimers.set(threadId, timer);
		}
		this.notify();
	}

	isThreadActionBlocked(threadId: string): boolean {
		return this.actionGate.isBlocked(threadId);
	}

	isThreadActionInFlight(threadId: string): boolean {
		return this.actionGate.isInFlight(threadId);
	}

	markShippingDispatched(threadId: string): void {
		const alreadyWorking = this.topSnapshot.threads.find((thread) => thread.id === threadId)?.working ?? false;
		this.shippingLifecycle.markDispatched(threadId, Date.now(), alreadyWorking);
		this.persistShippingState();
		this.scheduleShippingExpiry();
		this.rebuildSnapshot();
	}

	acquire(): () => void {
		this.users += 1;
		if (this.users === 1) {
			this.source.start();
			this.usageTimer = setInterval(() => void this.refreshSelectedUsage(), 30_000);
			this.usageTimer.unref();
			this.reconciliationTimer = setInterval(() => void this.refreshThreadMetadata(), reconciliationIntervalMs);
			this.reconciliationTimer.unref();
			void this.restoreShippingState();
			this.scheduleShippingExpiry();
			void this.refreshThreadMetadata();
			void this.refreshSelectedUsage();
		}

		let released = false;
		return () => {
			if (released) {
				return;
			}

			released = true;
			this.users -= 1;
			if (this.users === 0) {
				this.source.stop();
				if (this.shippingExpiryTimer) clearTimeout(this.shippingExpiryTimer);
				this.shippingExpiryTimer = undefined;
				if (this.usageTimer) clearInterval(this.usageTimer);
				this.usageTimer = undefined;
				if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
				this.reconciliationTimer = undefined;
				this.cancelUsageRetries();
			}
		};
	}

	selectThread(threadId: string): void {
		if (this.selectedThreadId === threadId) {
			return;
		}

		this.selectedThreadId = threadId;
		this.selectionRevision += 1;
		this.cancelUsageRetries();
		this.notify();
		if (this.users > 0) void this.refreshSelectedUsage();
	}

	clearSelection(threadId: string): void {
		if (this.selectedThreadId !== threadId) {
			return;
		}

		this.selectedThreadId = undefined;
		this.selectionRevision += 1;
		this.cancelUsageRetries();
		this.notify();
	}

	subscribe(listener: ThreadStoreListener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.source.stop();
		if (this.shippingExpiryTimer) clearTimeout(this.shippingExpiryTimer);
		if (this.usageTimer) clearInterval(this.usageTimer);
		if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
		this.shippingExpiryTimer = undefined;
		this.usageTimer = undefined;
		this.reconciliationTimer = undefined;
		this.cancelUsageRetries();
		for (const timer of this.actionCooldownTimers.values()) clearTimeout(timer);
		this.actionCooldownTimers.clear();
		this.actionGate.clear();
		this.users = 0;
		this.listeners.clear();
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener(this.snapshot);
		}
	}

	private rebuildSnapshot(): void {
		const threads = this.topSnapshot.threads.filter((thread) => this.shouldKeepReconciledThread(thread));
		const visibleThreadIds = new Set(threads.map((thread) => thread.id));
		for (const threadId of this.usageCosts.keys()) {
			if (!visibleThreadIds.has(threadId)) this.usageCosts.delete(threadId);
		}
		if (this.selectedThreadId && !visibleThreadIds.has(this.selectedThreadId)) {
			this.selectedThreadId = undefined;
			this.selectionRevision += 1;
			this.cancelUsageRetries();
		}
		this.snapshot = {
			...this.topSnapshot,
			threads: threads.map((thread) => {
				const metadata = this.threadMetadata.get(thread.id);
				return {
					...thread,
					title: thread.title === thread.id ? (metadata?.title ?? thread.title) : thread.title,
					project: thread.project ?? metadata?.project,
					updatedAt: thread.updatedAt ?? metadata?.updatedAt,
					usageCost: this.usageCosts.get(thread.id),
					phase: this.shippingLifecycle.isShipping(thread) ? "shipping" : undefined,
				};
			}),
		};
		this.notify();
	}

	private async refreshThreadMetadata(): Promise<void> {
		if (this.users === 0 || this.reconciliationInFlight) return;

		this.reconciliationInFlight = true;
		try {
			const output = await this.runCommand(
				["--no-color", "threads", "list", "--json", "--limit", reconciliationLimit.toString()],
				reconciliationTimeoutMs,
			);
			const metadata = parseThreadMetadataList(output);
			if (!metadata) return;
			this.reconciliationInventoryComplete = metadata.length < reconciliationLimit;
			this.threadMetadata.clear();
			for (const thread of metadata) this.threadMetadata.set(thread.id, thread);
			this.rebuildSnapshot();
		} catch {
			// Reconciliation is supplementary; amp top remains the live inventory.
		} finally {
			this.reconciliationInFlight = false;
		}
	}

	private shouldKeepReconciledThread(thread: AmpTopThread): boolean {
		if (!this.reconciliationInventoryComplete || this.threadMetadata.has(thread.id)) return true;
		if (thread.working || thread.executorConnected || this.shippingLifecycle.isShipping(thread)) return true;
		return false;
	}

	private async refreshSelectedUsage(): Promise<void> {
		const threadId = this.selectedThreadId;
		if (this.users === 0 || !threadId || this.usageInFlight) return;

		this.usageInFlight = true;
		try {
			const output = await this.runCommand(["--no-color", "threads", "usage", threadId]);
			const cost = parseThreadUsageCost(output);
			if (cost) {
				this.usageCosts.set(threadId, cost);
				this.rebuildSnapshot();
			}
		} catch {
			// Usage is supplementary; inventory and controls remain available if it cannot be loaded.
		} finally {
			this.usageInFlight = false;
			if (this.users > 0 && this.selectedThreadId && this.selectedThreadId !== threadId) {
				void this.refreshSelectedUsage();
			}
		}
	}

	private scheduleUsageRetries(): void {
		const threadId = this.selectedThreadId;
		if (!threadId || this.users === 0) return;

		this.cancelUsageRetries();
		const refresh = (index: number): void => {
			this.usageRetryTimer = setTimeout(() => {
				this.usageRetryTimer = undefined;
				if (this.users === 0 || this.selectedThreadId !== threadId) return;
				void this.refreshSelectedUsage().finally(() => {
					if (this.users > 0 && this.selectedThreadId === threadId && index + 1 < usageRetryDelaysMs.length) {
						refresh(index + 1);
					}
				});
			}, usageRetryDelaysMs[index]);
			this.usageRetryTimer.unref();
		};
		refresh(0);
	}

	private cancelUsageRetries(): void {
		if (this.usageRetryTimer) clearTimeout(this.usageRetryTimer);
		this.usageRetryTimer = undefined;
	}

	private async restoreShippingState(): Promise<void> {
		if (!this.shippingPersistence) return;
		this.shippingLoadPromise ??= this.shippingPersistence.load().then((dispatches) => {
			this.shippingLifecycle.restore(dispatches);
			if (this.topSnapshot.connection === "live") {
				this.shippingLifecycle.reconcile(this.topSnapshot.threads);
			}
			this.persistShippingState();
			this.scheduleShippingExpiry();
			this.rebuildSnapshot();
		});
		await this.shippingLoadPromise;
	}

	private persistShippingState(): void {
		const persistence = this.shippingPersistence;
		if (!persistence) return;
		const dispatches = this.shippingLifecycle.toJSON();
		this.shippingPersistenceQueue = this.shippingPersistenceQueue
			.then(() => persistence.save(dispatches))
			.catch(() => undefined);
	}

	private scheduleShippingExpiry(): void {
		if (this.shippingExpiryTimer) clearTimeout(this.shippingExpiryTimer);
		this.shippingExpiryTimer = undefined;
		if (this.users === 0) return;
		const expiresAt = this.shippingLifecycle.nextExpiry();
		if (expiresAt === undefined) return;
		const timer = setTimeout(
			() => {
				this.shippingExpiryTimer = undefined;
				if (this.shippingLifecycle.reconcile(this.topSnapshot.threads, Date.now())) {
					this.persistShippingState();
					this.rebuildSnapshot();
				}
				this.scheduleShippingExpiry();
			},
			Math.max(0, expiresAt - Date.now()),
		);
		timer.unref();
		this.shippingExpiryTimer = timer;
	}
}
