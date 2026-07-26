import { AmpTopSource, type AmpTopSnapshot, type AmpTopThread } from "../amp/amp-top-source";
import { parseThreadSearchIds, parseThreadUsageCost, runAmpCommand } from "../amp/amp-command";
import { BridgeServer } from "../bridge/bridge-server";

type ThreadStoreListener = (snapshot: AmpTopSnapshot) => void;

export class ThreadStore {
	private readonly listeners = new Set<ThreadStoreListener>();
	private shippingLabelsInFlight = false;
	private shippingLabelsTimer: NodeJS.Timeout | undefined;
	private shippingThreadIds = new Set<string>();
	private readonly source = new AmpTopSource();
	private readonly usageCosts = new Map<string, string>();
	private usageInFlight = false;
	private usageTimer: NodeJS.Timeout | undefined;
	private topSnapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };
	private users = 0;

	selectionRevision = 0;
	selectedThreadId: string | undefined;
	snapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };

	constructor(private readonly bridge: BridgeServer) {
		this.source.onSnapshot((snapshot) => {
			this.topSnapshot = snapshot;
			this.rebuildSnapshot();
		});
		this.bridge.subscribe(() => this.rebuildSnapshot());
	}

	get selectedThread(): AmpTopThread | undefined {
		return this.snapshot.threads.find((thread) => thread.id === this.selectedThreadId);
	}

	acquire(): () => void {
		this.users += 1;
		if (this.users === 1) {
			this.source.start();
			this.shippingLabelsTimer = setInterval(() => void this.refreshShippingLabels(), 5_000);
			this.shippingLabelsTimer.unref();
			this.usageTimer = setInterval(() => void this.refreshSelectedUsage(), 30_000);
			this.usageTimer.unref();
			void this.refreshShippingLabels();
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
				if (this.shippingLabelsTimer) clearInterval(this.shippingLabelsTimer);
				this.shippingLabelsTimer = undefined;
				if (this.usageTimer) clearInterval(this.usageTimer);
				this.usageTimer = undefined;
			}
		};
	}

	selectThread(threadId: string): void {
		if (this.selectedThreadId === threadId) {
			return;
		}

		this.selectedThreadId = threadId;
		this.selectionRevision += 1;
		this.notify();
		void this.refreshSelectedUsage();
	}

	async acknowledgeSelectedThread(): Promise<void> {
		const thread = this.selectedThread;
		if (thread?.unread) {
			await this.bridge.sendCommand(thread.id, "acknowledge");
		}
	}

	clearSelection(threadId: string): void {
		if (this.selectedThreadId !== threadId) {
			return;
		}

		this.selectedThreadId = undefined;
		this.selectionRevision += 1;
		this.notify();
	}

	subscribe(listener: ThreadStoreListener): () => void {
		this.listeners.add(listener);
		listener(this.snapshot);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener(this.snapshot);
		}
	}

	private rebuildSnapshot(): void {
		const visibleThreadIds = new Set(this.topSnapshot.threads.map((thread) => thread.id));
		for (const threadId of this.usageCosts.keys()) {
			if (!visibleThreadIds.has(threadId)) this.usageCosts.delete(threadId);
		}
		this.snapshot = {
			...this.topSnapshot,
			companionConnected: this.bridge.hasCompanion(),
			threads: this.topSnapshot.threads.map((thread) => {
				const status = this.bridge.getStatus(thread.id);
				const shipping =
					this.bridge.observeShipping(thread.id, thread.working) || this.shippingThreadIds.has(thread.id);
				return {
					...thread,
					usageCost: this.usageCosts.get(thread.id),
					executorKind: status?.executorKind ?? "unknown",
					companionConnected: this.bridge.isThreadConnected(thread.id),
					...(status || shipping
						? {
								companionState: shipping ? ("running" as const) : status?.state,
								phase: shipping ? "shipping" : status?.phase,
								unread: status?.unread,
							}
						: {}),
				};
			}),
		};
		this.notify();
	}

	private async refreshShippingLabels(): Promise<void> {
		if (this.shippingLabelsInFlight) return;
		this.shippingLabelsInFlight = true;
		try {
			const output = await runAmpCommand([
				"--no-color",
				"threads",
				"search",
				"label:shipping",
				"--limit",
				"100",
				"--json",
			]);
			const threadIds = parseThreadSearchIds(output);
			if (!setsEqual(threadIds, this.shippingThreadIds)) {
				this.shippingThreadIds = threadIds;
				this.rebuildSnapshot();
			}
		} catch {
			// Preserve the last known labels when Amp search is temporarily unavailable.
		} finally {
			this.shippingLabelsInFlight = false;
		}
	}

	private async refreshSelectedUsage(): Promise<void> {
		const threadId = this.selectedThreadId;
		if (!threadId || this.usageInFlight) return;

		this.usageInFlight = true;
		try {
			const output = await runAmpCommand(["--no-color", "threads", "usage", threadId]);
			const cost = parseThreadUsageCost(output);
			if (cost && this.selectedThreadId === threadId) {
				this.usageCosts.set(threadId, cost);
				this.rebuildSnapshot();
			}
		} catch {
			// Usage is supplementary; inventory and controls remain available if it cannot be loaded.
		} finally {
			this.usageInFlight = false;
			if (this.selectedThreadId && this.selectedThreadId !== threadId) void this.refreshSelectedUsage();
		}
	}
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}
