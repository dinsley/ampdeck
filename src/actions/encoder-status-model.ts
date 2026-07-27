import type { AmpTopThread } from "../amp/amp-top-source";
import { splitGraphemes, truncateText } from "../rendering/text";

export type PhaseMetadata = {
	current: string;
	startedAt: number;
};

export function orderThreadsByAttention(threads: AmpTopThread[]): AmpTopThread[] {
	return threads
		.map((thread, index) => ({ thread, index }))
		.sort((left, right) => attentionRank(left.thread) - attentionRank(right.thread) || left.index - right.index)
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
	return previous.working && !current.working;
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
	const graphemes = splitGraphemes(title);
	if (graphemes.length <= maximumLineLength) return [graphemes.join("")];

	const candidate = graphemes.slice(0, maximumLineLength + 1);
	const lastWhitespace = candidate.findLastIndex((grapheme) => /\s/u.test(grapheme));
	const splitAt = Math.max(lastWhitespace, 28);
	const first = graphemes.slice(0, splitAt).join("").trim();
	const second = truncateText(graphemes.slice(splitAt).join("").trim(), maximumLineLength);
	return [first, second];
}

function attentionRank(thread: AmpTopThread): number {
	if (thread.phase === "shipping") return 0;
	if (thread.working) return 1;
	return 2;
}
