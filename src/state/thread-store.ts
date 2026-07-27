import streamDeck from "@elgato/streamdeck";

import { AmpTopSource, type AmpTopSnapshot, type AmpTopThread } from "../amp/amp-top-source";
import { parseThreadExportDetails, parseThreadUsageCost, runAmpCommand } from "../amp/amp-command";
import type { ExecutionOrigin } from "../amp/amp-top-model";
import { parseThreadMetadataList, type AmpThreadMetadata } from "../amp/amp-threads-model";
import { getErrorMessage } from "../error-message";
import { reachedUsageBoundary } from "../model/thread-status";
import { ShippingLifecycle, ThreadActionGate, type ShippingDispatchState } from "./thread-store-model";

type ThreadStoreListener = (snapshot: AmpTopSnapshot) => void;
type TopSource = Pick<AmpTopSource, "onSnapshot" | "start" | "stop">;

const defaultDetailRetryDelaysMs = [30_000, 60_000];
const defaultDetailMinimumIntervalMs = 30_000;
const defaultWorkingDetailFallbackMs = 5 * 60_000;
const detailCommandTimeoutMs = 15_000;
const detailExportMaximumOutputBytes = 5 * 1024 * 1024;
const reconciliationIntervalMs = 60_000;
const reconciliationTimeoutMs = 5_000;
const reconciliationLimit = 100;
const logger = streamDeck.logger.createScope("ThreadStore");

export type ShippingStatePersistence = {
	load(): Promise<ShippingDispatchState[]>;
	save(dispatches: ShippingDispatchState[]): Promise<void>;
};

type ThreadStoreOptions = {
	source?: TopSource;
	runCommand?: typeof runAmpCommand;
	shippingPersistence?: ShippingStatePersistence;
	shippingStartTimeoutMs?: number;
	detailMinimumIntervalMs?: number;
	detailRetryDelaysMs?: number[];
	workingDetailFallbackMs?: number;
};

export class ThreadStore {
	private readonly actionCooldownTimers = new Map<string, NodeJS.Timeout>();
	private readonly actionGate = new ThreadActionGate();
	private detailInFlight = false;
	private readonly detailMinimumIntervalMs: number;
	private detailRefreshQueued = false;
	private readonly detailRetryDelaysMs: number[];
	private detailRetryTimer: NodeJS.Timeout | undefined;
	private detailUsers = 0;
	private detailWorkingTimer: NodeJS.Timeout | undefined;
	private readonly detailUpdatedAt = new Map<string, number>();
	private readonly executionOrigins = new Map<string, ExecutionOrigin>();
	private readonly listeners = new Set<ThreadStoreListener>();
	private reconciliationInFlight = false;
	private reconciliationInventoryComplete = false;
	private reconciliationWarningLogged = false;
	private reconciliationTimer: NodeJS.Timeout | undefined;
	private readonly threadMetadata = new Map<string, AmpThreadMetadata>();
	private readonly shippingLifecycle: ShippingLifecycle;
	private shippingExpiryTimer: NodeJS.Timeout | undefined;
	private shippingLoadPromise: Promise<void> | undefined;
	private shippingPersistenceQueue = Promise.resolve();
	private readonly shippingPersistence: ShippingStatePersistence | undefined;
	private readonly source: TopSource;
	private readonly runCommand: typeof runAmpCommand;
	private readonly tokensUsed = new Map<string, number>();
	private readonly usageCosts = new Map<string, string>();
	private topSnapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };
	private users = 0;
	private readonly workingDetailFallbackMs: number;

	selectionRevision = 0;
	selectedThreadId: string | undefined;
	snapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };

	constructor(options: ThreadStoreOptions = {}) {
		this.source = options.source ?? new AmpTopSource();
		this.runCommand = options.runCommand ?? runAmpCommand;
		this.detailMinimumIntervalMs = options.detailMinimumIntervalMs ?? defaultDetailMinimumIntervalMs;
		this.detailRetryDelaysMs = options.detailRetryDelaysMs ?? defaultDetailRetryDelaysMs;
		this.workingDetailFallbackMs = options.workingDetailFallbackMs ?? defaultWorkingDetailFallbackMs;
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
			if (reachedUsageBoundary(previous, this.selectedThread)) this.scheduleDetailRetries();
			if (connectionBecameLive && this.users > 0) {
				void this.restoreShippingState();
				void this.refreshThreadMetadata();
			}
			if (connectionBecameLive && this.detailUsers > 0) this.requestSelectedDetails();
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
			logger.info("Activating thread monitoring");
			this.source.start();
			this.reconciliationTimer = setInterval(() => void this.refreshThreadMetadata(), reconciliationIntervalMs);
			this.reconciliationTimer.unref();
			void this.restoreShippingState();
			this.scheduleShippingExpiry();
			void this.refreshThreadMetadata();
		}

		let released = false;
		return () => {
			if (released) {
				return;
			}

			released = true;
			this.users -= 1;
			if (this.users === 0) {
				logger.info("Pausing thread monitoring");
				this.source.stop();
				if (this.shippingExpiryTimer) clearTimeout(this.shippingExpiryTimer);
				this.shippingExpiryTimer = undefined;
				if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
				this.reconciliationTimer = undefined;
			}
		};
	}

	acquireStatusDetails(): () => void {
		this.detailUsers += 1;
		if (this.detailUsers === 1) this.requestSelectedDetails();

		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.detailUsers -= 1;
			if (this.detailUsers === 0) this.cancelDetailTimers();
		};
	}

	selectThread(threadId: string): void {
		if (this.selectedThreadId === threadId) {
			return;
		}

		this.selectedThreadId = threadId;
		this.selectionRevision += 1;
		logger.debug("Selected thread changed");
		this.cancelDetailTimers();
		this.notify();
		this.requestSelectedDetails();
	}

	clearSelection(threadId: string): void {
		if (this.selectedThreadId !== threadId) {
			return;
		}

		this.selectedThreadId = undefined;
		this.selectionRevision += 1;
		this.cancelDetailTimers();
		this.notify();
	}

	subscribe(listener: ThreadStoreListener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		logger.debug("Disposing thread store");
		this.source.stop();
		if (this.shippingExpiryTimer) clearTimeout(this.shippingExpiryTimer);
		if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
		this.shippingExpiryTimer = undefined;
		this.reconciliationTimer = undefined;
		this.cancelDetailTimers();
		for (const timer of this.actionCooldownTimers.values()) clearTimeout(timer);
		this.actionCooldownTimers.clear();
		this.actionGate.clear();
		this.detailUsers = 0;
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
		const prunedThreadCount = this.topSnapshot.threads.length - threads.length;
		if (prunedThreadCount > 0) logger.debug(`Pruned ${prunedThreadCount} stale completed thread(s)`);
		const visibleThreadIds = new Set(threads.map((thread) => thread.id));
		for (const threadId of this.usageCosts.keys()) {
			if (!visibleThreadIds.has(threadId)) this.usageCosts.delete(threadId);
		}
		for (const threadId of this.tokensUsed.keys()) {
			if (!visibleThreadIds.has(threadId)) this.tokensUsed.delete(threadId);
		}
		for (const threadId of this.detailUpdatedAt.keys()) {
			if (!visibleThreadIds.has(threadId)) this.detailUpdatedAt.delete(threadId);
		}
		for (const threadId of this.executionOrigins.keys()) {
			if (!visibleThreadIds.has(threadId)) this.executionOrigins.delete(threadId);
		}
		if (this.selectedThreadId && !visibleThreadIds.has(this.selectedThreadId)) {
			this.selectedThreadId = undefined;
			this.selectionRevision += 1;
			this.cancelDetailTimers();
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
					executionOrigin: thread.executionOrigin ?? this.executionOrigins.get(thread.id),
					usageCost: this.usageCosts.get(thread.id),
					tokensUsed: this.tokensUsed.get(thread.id),
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
			if (!metadata) {
				if (!this.reconciliationWarningLogged) {
					this.reconciliationWarningLogged = true;
					logger.warn("Amp thread metadata response was not recognized; keeping the live status inventory");
				}
				return;
			}
			this.reconciliationWarningLogged = false;
			this.reconciliationInventoryComplete = metadata.length < reconciliationLimit;
			this.threadMetadata.clear();
			for (const thread of metadata) this.threadMetadata.set(thread.id, thread);
			logger.debug(
				`Reconciled ${metadata.length} thread metadata record(s); inventory complete: ${this.reconciliationInventoryComplete}`,
			);
			this.rebuildSnapshot();
		} catch (error) {
			// Reconciliation is supplementary; amp top remains the live inventory.
			logger.debug(`Unable to reconcile thread metadata: ${getErrorMessage(error)}`);
		} finally {
			this.reconciliationInFlight = false;
		}
	}

	private shouldKeepReconciledThread(thread: AmpTopThread): boolean {
		if (!this.reconciliationInventoryComplete || this.threadMetadata.has(thread.id)) return true;
		if (thread.working || thread.executorConnected || this.shippingLifecycle.isShipping(thread)) return true;
		return false;
	}

	private requestSelectedDetails(): void {
		const threadId = this.selectedThreadId;
		if (this.detailUsers === 0 || this.topSnapshot.connection !== "live" || !threadId) return;
		if (this.detailInFlight) {
			this.detailRefreshQueued = true;
			return;
		}
		void this.refreshSelectedDetails(threadId);
	}

	private async refreshSelectedDetails(threadId: string): Promise<void> {
		this.detailInFlight = true;
		const now = Date.now();
		const refreshDue = now - (this.detailUpdatedAt.get(threadId) ?? 0) >= this.detailMinimumIntervalMs;
		try {
			if (refreshDue)
				await Promise.all([this.refreshSelectedCost(threadId), this.refreshSelectedExport(threadId, now)]);
		} finally {
			this.detailInFlight = false;
			this.scheduleWorkingDetailFallback();
			if (this.detailRefreshQueued || this.selectedThreadId !== threadId) {
				this.detailRefreshQueued = false;
				this.requestSelectedDetails();
			}
		}
	}

	private async refreshSelectedCost(threadId: string): Promise<void> {
		try {
			const output = await this.runCommand(["--no-color", "threads", "usage", threadId], detailCommandTimeoutMs);
			const cost = parseThreadUsageCost(output);
			if (cost) {
				this.usageCosts.set(threadId, cost);
				this.rebuildSnapshot();
			}
		} catch (error) {
			// Usage is supplementary; inventory and controls remain available if it cannot be loaded.
			logger.debug(`Unable to refresh selected thread cost: ${getErrorMessage(error)}`);
		}
	}

	private async refreshSelectedExport(threadId: string, refreshedAt: number): Promise<void> {
		try {
			const output = await this.runCommand(
				["--no-color", "threads", "export", threadId],
				detailCommandTimeoutMs,
				detailExportMaximumOutputBytes,
			);
			const details = parseThreadExportDetails(output);
			if (details?.tokensUsed !== undefined) this.tokensUsed.set(threadId, details.tokensUsed);
			if (details) this.executionOrigins.set(threadId, details.executionOrigin);
			this.detailUpdatedAt.set(threadId, refreshedAt);
			this.rebuildSnapshot();
		} catch (error) {
			// Export output is discarded immediately and is never logged or persisted.
			logger.debug(`Unable to refresh selected thread token usage: ${getErrorMessage(error)}`);
		}
	}

	private scheduleDetailRetries(): void {
		const threadId = this.selectedThreadId;
		if (!threadId || this.detailUsers === 0) return;

		this.cancelDetailTimers();
		this.requestSelectedDetails();
		const refresh = (index: number): void => {
			const delay = this.detailRetryDelaysMs[index];
			if (delay === undefined) return;
			this.detailRetryTimer = setTimeout(() => {
				this.detailRetryTimer = undefined;
				if (this.detailUsers === 0 || this.selectedThreadId !== threadId) return;
				this.requestSelectedDetails();
				refresh(index + 1);
			}, delay);
			this.detailRetryTimer.unref();
		};
		refresh(0);
	}

	private scheduleWorkingDetailFallback(): void {
		if (this.detailWorkingTimer) clearTimeout(this.detailWorkingTimer);
		this.detailWorkingTimer = undefined;
		if (this.detailUsers === 0 || !this.selectedThread?.working) return;
		this.detailWorkingTimer = setTimeout(() => {
			this.detailWorkingTimer = undefined;
			this.requestSelectedDetails();
		}, this.workingDetailFallbackMs);
		this.detailWorkingTimer.unref();
	}

	private cancelDetailTimers(): void {
		if (this.detailRetryTimer) clearTimeout(this.detailRetryTimer);
		if (this.detailWorkingTimer) clearTimeout(this.detailWorkingTimer);
		this.detailRetryTimer = undefined;
		this.detailWorkingTimer = undefined;
		this.detailRefreshQueued = false;
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
