import type { AmpTopThread } from "../amp/amp-top-source";

export type PhaseMetadata = {
	current: string;
	startedAt: number;
};

export type Overview = {
	alerts: number;
	unread: number;
};

export function orderThreadsByAttention(threads: AmpTopThread[], now = Date.now()): AmpTopThread[] {
	return threads
		.map((thread, index) => ({ thread, index }))
		.sort(
			(left, right) => attentionRank(left.thread, now) - attentionRank(right.thread, now) || left.index - right.index,
		)
		.map(({ thread }) => thread);
}

export function chooseFocusedThread(
	threads: AmpTopThread[],
	selectedThreadId: string | undefined,
	focusedThreadId: string | undefined,
): AmpTopThread | undefined {
	return (
		threads.find((thread) => thread.id === selectedThreadId) ??
		threads.find((thread) => thread.id === focusedThreadId) ??
		orderThreadsByAttention(threads)[0]
	);
}

export function reachedUsageBoundary(previous: AmpTopThread | undefined, current: AmpTopThread | undefined): boolean {
	if (!previous || !current || previous.id !== current.id) return false;
	return (
		(previous.working && !current.working) ||
		(previous.companionState === "running" && current.companionState !== "running")
	);
}

export function getOverview(threads: AmpTopThread[]): Overview {
	return {
		alerts: threads.filter(
			(thread) => thread.companionState === "awaiting-approval" || thread.companionState === "error",
		).length,
		unread: threads.filter((thread) => thread.unread).length,
	};
}

export function updatePhaseMetadata(
	metadata: Map<string, PhaseMetadata>,
	statuses: Array<{ id: string; status: string }>,
	now = Date.now(),
): void {
	const visibleThreadIds = new Set(statuses.map(({ id }) => id));
	for (const threadId of metadata.keys()) {
		if (!visibleThreadIds.has(threadId)) metadata.delete(threadId);
	}

	for (const { id, status } of statuses) {
		const current = metadata.get(id);
		if (!current) {
			metadata.set(id, { current: status, startedAt: now });
		} else if (current.current !== status) {
			current.current = status;
			current.startedAt = now;
		}
	}
}

export function splitTitle(title: string): string[] {
	const maximumLineLength = 53;
	if (title.length <= maximumLineLength) return [title];

	const candidate = title.slice(0, maximumLineLength + 1);
	const splitAt = Math.max(candidate.lastIndexOf(" "), 28);
	const first = title.slice(0, splitAt).trim();
	const second = truncate(title.slice(splitAt).trim(), maximumLineLength);
	return [first, second];
}

function attentionRank(thread: AmpTopThread, now: number): number {
	if (thread.companionState === "awaiting-approval") return 0;
	if (thread.companionState === "error") return 1;
	if (thread.unread) return 2;
	if (thread.phase === "shipping") return 3;
	if (thread.working || thread.companionState === "running") return 4;
	if (thread.companionState === "done" && isRecentlyUpdated(thread.updatedAt, now)) return 5;
	return 6;
}

function isRecentlyUpdated(updatedAt: string | undefined, now: number): boolean {
	if (!updatedAt) return false;
	const elapsed = now - Date.parse(updatedAt);
	return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 15 * 60 * 1000;
}

function truncate(value: string, length: number): string {
	return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
