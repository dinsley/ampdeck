type WorkingThread = { id: string; working: boolean };

type ShippingDispatch = {
	observedWorking: boolean;
	expiresAt: number;
};

export type ShippingDispatchState = ShippingDispatch & {
	threadId: string;
};

export class ThreadActionGate {
	private readonly cooldownUntil = new Map<string, number>();
	private readonly inFlightThreadIds = new Set<string>();

	tryAcquire(threadId: string, now = performance.now()): boolean {
		if (this.isBlocked(threadId, now)) return false;
		this.inFlightThreadIds.add(threadId);
		return true;
	}

	release(threadId: string, cooldownMs = 0, now = performance.now()): void {
		this.inFlightThreadIds.delete(threadId);
		if (cooldownMs > 0) this.cooldownUntil.set(threadId, now + cooldownMs);
		else this.cooldownUntil.delete(threadId);
	}

	isBlocked(threadId: string, now = performance.now()): boolean {
		return this.inFlightThreadIds.has(threadId) || (this.cooldownUntil.get(threadId) ?? 0) > now;
	}

	isInFlight(threadId: string): boolean {
		return this.inFlightThreadIds.has(threadId);
	}

	clearCooldown(threadId: string): void {
		this.cooldownUntil.delete(threadId);
	}

	clear(): void {
		this.cooldownUntil.clear();
		this.inFlightThreadIds.clear();
	}
}

export class ShippingLifecycle {
	private readonly dispatches = new Map<string, ShippingDispatch>();
	private readonly startTimeoutMs: number;

	constructor(startTimeoutMs = 2 * 60_000) {
		this.startTimeoutMs = startTimeoutMs;
	}

	markDispatched(threadId: string, now = Date.now(), alreadyWorking = false): void {
		this.dispatches.set(threadId, { observedWorking: alreadyWorking, expiresAt: now + this.startTimeoutMs });
	}

	restore(states: ShippingDispatchState[], now = Date.now()): void {
		for (const state of states) {
			if (
				!state.threadId ||
				typeof state.observedWorking !== "boolean" ||
				!Number.isFinite(state.expiresAt) ||
				(!state.observedWorking && state.expiresAt <= now) ||
				this.dispatches.has(state.threadId)
			) {
				continue;
			}
			this.dispatches.set(state.threadId, {
				observedWorking: state.observedWorking,
				expiresAt: state.expiresAt,
			});
		}
	}

	reconcile(threads: WorkingThread[], now = Date.now()): boolean {
		let changed = false;
		for (const [threadId, dispatch] of this.dispatches) {
			const thread = threads.find((candidate) => candidate.id === threadId);
			if (thread?.working && !dispatch.observedWorking) {
				dispatch.observedWorking = true;
				changed = true;
			} else if (!thread?.working && (dispatch.observedWorking || now >= dispatch.expiresAt)) {
				this.dispatches.delete(threadId);
				changed = true;
			}
		}
		return changed;
	}

	isShipping(thread: WorkingThread): boolean {
		return this.dispatches.has(thread.id);
	}

	nextExpiry(): number | undefined {
		let next: number | undefined;
		for (const dispatch of this.dispatches.values()) {
			if (!dispatch.observedWorking && (next === undefined || dispatch.expiresAt < next)) {
				next = dispatch.expiresAt;
			}
		}
		return next;
	}

	toJSON(): ShippingDispatchState[] {
		return [...this.dispatches].map(([threadId, dispatch]) => ({ threadId, ...dispatch }));
	}
}
