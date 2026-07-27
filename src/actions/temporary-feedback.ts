type FeedbackAction = {
	id: string;
	setImage(image: string): Promise<void>;
};

export class TemporaryFeedback<T> {
	private readonly feedback = new Map<string, T>();
	private readonly generations = new Map<string, number>();
	private readonly requests = new Map<string, number>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly visibleActionIds = new Set<string>();

	get visibleCount(): number {
		return this.visibleActionIds.size;
	}

	appear(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) clearTimeout(timer);
		this.timers.delete(actionId);
		this.feedback.delete(actionId);
		this.generations.set(actionId, (this.generations.get(actionId) ?? 0) + 1);
		this.requests.set(actionId, (this.requests.get(actionId) ?? 0) + 1);
		this.visibleActionIds.add(actionId);
	}

	disappear(actionId: string): void {
		this.generations.set(actionId, (this.generations.get(actionId) ?? 0) + 1);
		this.requests.set(actionId, (this.requests.get(actionId) ?? 0) + 1);
		this.visibleActionIds.delete(actionId);
		this.feedback.delete(actionId);
		const timer = this.timers.get(actionId);
		if (timer) clearTimeout(timer);
		this.timers.delete(actionId);
	}

	generation(actionId: string): number | undefined {
		return this.generations.get(actionId);
	}

	isCurrent(actionId: string, expectedGeneration = this.generation(actionId)): boolean {
		return this.visibleActionIds.has(actionId) && this.generation(actionId) === expectedGeneration;
	}

	isVisible(actionId: string): boolean {
		return this.visibleActionIds.has(actionId);
	}

	get(actionId: string): T | undefined {
		return this.feedback.get(actionId);
	}

	async show(
		action: FeedbackAction,
		value: T,
		image: string,
		restore: () => Promise<void>,
		onRestoreError: (error: unknown) => void,
		expectedGeneration = this.generation(action.id),
		durationMs = 800,
	): Promise<void> {
		if (!this.isCurrent(action.id, expectedGeneration)) return;
		const previousTimer = this.timers.get(action.id);
		if (previousTimer) clearTimeout(previousTimer);
		this.timers.delete(action.id);

		const request = (this.requests.get(action.id) ?? 0) + 1;
		this.requests.set(action.id, request);
		this.feedback.set(action.id, value);
		try {
			await action.setImage(image);
		} catch (error) {
			if (this.isCurrent(action.id, expectedGeneration) && this.requests.get(action.id) === request) {
				this.feedback.delete(action.id);
			}
			throw error;
		}
		if (!this.isCurrent(action.id, expectedGeneration) || this.requests.get(action.id) !== request) return;

		const timer = setTimeout(() => {
			if (!this.isCurrent(action.id, expectedGeneration) || this.requests.get(action.id) !== request) return;
			this.timers.delete(action.id);
			this.feedback.delete(action.id);
			void restore().catch(onRestoreError);
		}, durationMs);
		timer.unref();
		this.timers.set(action.id, timer);
	}
}
