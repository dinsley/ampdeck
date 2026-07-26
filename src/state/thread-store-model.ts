type WorkingThread = { id: string; working: boolean };

type ShippingDispatch = {
	observedWorking: boolean;
	expiresAt: number;
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
	private labeledThreadIds = new Set<string>();
	private readonly startTimeoutMs: number;

	constructor(startTimeoutMs = 2 * 60_000) {
		this.startTimeoutMs = startTimeoutMs;
	}

	markDispatched(threadId: string, now = Date.now(), alreadyWorking = false): void {
		this.dispatches.set(threadId, { observedWorking: alreadyWorking, expiresAt: now + this.startTimeoutMs });
	}

	setLabels(threadIds: Set<string>): void {
		this.labeledThreadIds = threadIds;
	}

	reconcile(threads: WorkingThread[], now = Date.now()): void {
		for (const [threadId, dispatch] of this.dispatches) {
			const thread = threads.find((candidate) => candidate.id === threadId);
			if (thread?.working) dispatch.observedWorking = true;
			else if (dispatch.observedWorking || now >= dispatch.expiresAt) this.dispatches.delete(threadId);
		}
	}

	isShipping(thread: WorkingThread): boolean {
		return this.dispatches.has(thread.id) || (this.labeledThreadIds.has(thread.id) && thread.working);
	}
}
