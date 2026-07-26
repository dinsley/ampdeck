import { AmpTopSource, type AmpTopSnapshot, type AmpTopThread } from "../amp/amp-top-source";
import { parseThreadUsageCost, runAmpCommand } from "../amp/amp-command";
import { BridgeServer } from "../bridge/bridge-server";

type ThreadStoreListener = (snapshot: AmpTopSnapshot) => void;

export class ThreadStore {
	private readonly listeners = new Set<ThreadStoreListener>();
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
			this.usageTimer = setInterval(() => void this.refreshSelectedUsage(), 30_000);
			this.usageTimer.unref();
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
				const shipping = this.bridge.observeShipping(thread.id, thread.working);
				return {
					...thread,
					usageCost: this.usageCosts.get(thread.id),
					executorKind: status?.executorKind ?? "unknown",
					companionConnected: this.bridge.isThreadConnected(thread.id),
					...(status || shipping ? {
						companionState: shipping ? "running" as const : status?.state,
						phase: shipping ? "shipping" : status?.phase,
						unread: status?.unread,
					} : {}),
				};
			}),
		};
		this.notify();
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
