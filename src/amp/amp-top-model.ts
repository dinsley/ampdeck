export type AmpTopThread = {
	id: string;
	title: string;
	url?: string;
	project?: string;
	updatedAt?: string;
	working: boolean;
	executorConnected: boolean;
	phase?: string;
	usageCost?: string;
};

export type AmpTopSnapshot = {
	connection: "connecting" | "live" | "offline";
	threads: AmpTopThread[];
};

const maximumJsonlRecordBytes = 1024 * 1024;

export type JsonlEvent = { kind: "line"; line: string } | { kind: "oversized" };

export class JsonlLineBuffer {
	private buffer = "";
	private discardingOversizedRecord = false;

	push(chunk: string): JsonlEvent[] {
		const events: JsonlEvent[] = [];
		const parts = chunk.split("\n");
		for (const [index, part] of parts.entries()) {
			const terminated = index < parts.length - 1;
			if (this.discardingOversizedRecord) {
				if (terminated) this.discardingOversizedRecord = false;
				continue;
			}
			this.buffer += part;
			if (Buffer.byteLength(this.buffer) > maximumJsonlRecordBytes) {
				this.buffer = "";
				this.discardingOversizedRecord = !terminated;
				events.push({ kind: "oversized" });
				continue;
			}
			if (terminated) {
				events.push({
					kind: "line",
					line: this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer,
				});
				this.buffer = "";
			}
		}
		return events;
	}

	finish(): string | undefined {
		if (this.discardingOversizedRecord || !this.buffer) return undefined;
		const line = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
		this.buffer = "";
		return line;
	}
}

export function parseSnapshot(line: string): AmpTopSnapshot | undefined {
	try {
		const value: unknown = JSON.parse(line);
		if (!isRecord(value) || !Array.isArray(value.threads) || typeof value.reconnecting !== "boolean") {
			return undefined;
		}

		const threads: AmpTopThread[] = [];
		for (const thread of value.threads as unknown[]) {
			if (
				!isRecord(thread) ||
				typeof thread.id !== "string" ||
				typeof thread.working !== "boolean" ||
				typeof thread.executorConnected !== "boolean"
			) {
				return undefined;
			}
			threads.push({
				id: thread.id,
				title: typeof thread.title === "string" ? thread.title : thread.id,
				url: typeof thread.url === "string" ? thread.url : undefined,
				project: typeof thread.project === "string" ? thread.project : undefined,
				updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : undefined,
				working: thread.working,
				executorConnected: thread.executorConnected,
			});
		}

		return {
			connection: value.reconnecting ? "connecting" : "live",
			threads,
		};
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
