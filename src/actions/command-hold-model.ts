export type CommandHoldTarget = {
	threadId: string;
	selectionRevision: number;
	startedAt: number;
};

export type CommandHoldEvaluation = "pending" | "ready" | "invalidated";

export function evaluateCommandHold(
	hold: CommandHoldTarget,
	selectedThreadId: string | undefined,
	selectionRevision: number,
	holdDurationMs: number,
	now = performance.now(),
): CommandHoldEvaluation {
	if (hold.threadId !== selectedThreadId || hold.selectionRevision !== selectionRevision) return "invalidated";
	return now - hold.startedAt >= holdDurationMs ? "ready" : "pending";
}
