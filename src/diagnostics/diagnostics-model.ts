import type { AmpTopSnapshot, AmpTopThread } from "../amp/amp-top-model";

export type DiagnosticErrorKind =
	"authentication" | "incompatible" | "missing-cli" | "schema-mismatch" | "timeout" | "transient" | "unknown";

export type ClassifiedDiagnosticError = {
	kind: DiagnosticErrorKind;
	message: string;
	occurredAt: string;
};

export type AmpSourceDiagnostics = {
	executableSource: "automatic";
	statusSource: AmpTopSnapshot["connection"] | "paused";
	lastValidSnapshotAt?: string;
	consecutiveFailures: number;
	retryAttempt: number;
	nextRetryAt?: string;
	schemaCompatibility: "compatible" | "mismatch" | "unknown";
	lastMonitoringError?: ClassifiedDiagnosticError;
};

export type CommandAvailability = {
	enabled: boolean;
	state: "disabled" | "enabled" | "partial";
	reason: string;
};

export const initialAmpSourceDiagnostics: AmpSourceDiagnostics = {
	executableSource: "automatic",
	statusSource: "paused",
	consecutiveFailures: 0,
	retryAttempt: 0,
	schemaCompatibility: "unknown",
};

export function classifyDiagnosticError(
	error: unknown,
	occurredAt = new Date().toISOString(),
): ClassifiedDiagnosticError {
	const text = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
	if (/enoent|not found|cannot find|no such file/u.test(text)) {
		return { kind: "missing-cli", message: "Amp CLI executable was not found.", occurredAt };
	}
	if (/timed? ?out|timeout|did not acknowledge/u.test(text)) {
		return { kind: "timeout", message: "Amp CLI did not respond before the timeout.", occurredAt };
	}
	if (/sign.?in|log.?in|auth|unauthori[sz]ed|forbidden|credential/u.test(text)) {
		return { kind: "authentication", message: "Amp authentication is unavailable.", occurredAt };
	}
	if (/schema|unexpected response|malformed|invalid json/u.test(text)) {
		return { kind: "schema-mismatch", message: "Amp returned an incompatible response schema.", occurredAt };
	}
	if (/unknown (command|option)|unsupported|not recognized|unrecognized/u.test(text)) {
		return { kind: "incompatible", message: "The Amp CLI does not support a required command or option.", occurredAt };
	}
	if (/network|socket|econn|enotfound|fetch|temporar|unavailable|closed|exit/u.test(text)) {
		return { kind: "transient", message: "Amp CLI or its connection is temporarily unavailable.", occurredAt };
	}
	return { kind: "unknown", message: "Amp CLI reported an unclassified failure.", occurredAt };
}

export function commandAvailability(
	snapshot: AmpTopSnapshot,
	selectedThread: AmpTopThread | undefined,
	blocked = false,
): CommandAvailability {
	if (snapshot.connection === "connecting") {
		return { enabled: false, state: "disabled", reason: "Amp status is connecting." };
	}
	if (snapshot.connection === "offline") {
		return { enabled: false, state: "disabled", reason: "Amp status is offline." };
	}
	if (!selectedThread) return { enabled: false, state: "disabled", reason: "No thread is selected." };
	if (selectedThread.working) {
		return { enabled: false, state: "disabled", reason: "The selected thread is working." };
	}
	if (selectedThread.phase === "shipping") {
		return { enabled: false, state: "disabled", reason: "The selected thread is shipping." };
	}
	if (blocked) {
		return {
			enabled: false,
			state: "disabled",
			reason: "The selected thread is handling another command or cooldown.",
		};
	}
	if (!selectedThread.executorConnected) {
		return {
			enabled: true,
			state: "partial",
			reason: "Archive is enabled; Review and Ship require a connected executor.",
		};
	}
	return { enabled: true, state: "enabled", reason: "Thread commands are enabled." };
}

export function formatDiagnosticsReport(fields: ReadonlyArray<readonly [string, string]>): string {
	const lines = ["Amp Deck diagnostics", ...fields.map(([label, value]) => `${label}: ${singleLine(value)}`)];
	return `${lines.join("\n").slice(0, 8_192)}\n`;
}

function singleLine(value: string): string {
	return (
		value
			.replace(/[\r\n\t]+/gu, " ")
			.trim()
			.slice(0, 300) || "Unavailable"
	);
}
