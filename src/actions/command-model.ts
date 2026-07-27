import type { AmpTopSnapshot } from "../amp/amp-top-model";

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

export type CommandKeyState = {
	available: boolean;
	footer: string;
	loading: boolean;
};

export function getCommandKeyState(input: {
	connection: AmpTopSnapshot["connection"];
	hasThread: boolean;
	working: boolean;
	shipping: boolean;
	actionInFlight: boolean;
	threadInFlight: boolean;
	blocked: boolean;
	missingExecutor: boolean;
}): CommandKeyState {
	if (input.connection === "connecting") return unavailableState("CONNECTING");
	if (input.connection === "offline") return unavailableState("OFFLINE");
	if (!input.hasThread) return unavailableState("SELECT THREAD");
	if (input.shipping) return unavailableState("SHIPPING");
	if (input.actionInFlight) return unavailableState("BUSY", true);
	if (input.threadInFlight) return unavailableState("BUSY");
	if (input.working) return unavailableState("WORKING");
	if (input.blocked) return unavailableState("SENT");
	if (input.missingExecutor) return unavailableState("NO EXECUTOR");
	return { available: true, footer: "", loading: false };
}

function unavailableState(footer: string, loading = false): CommandKeyState {
	return { available: false, footer, loading };
}
