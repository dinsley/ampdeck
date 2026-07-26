import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import streamDeck from "@elgato/streamdeck";

import { resolveAmpCommand } from "./amp-command";

export type AmpTopThread = {
	id: string;
	title: string;
	url?: string;
	project?: string;
	updatedAt?: string;
	working: boolean;
	executorConnected: boolean;
	companionConnected?: boolean;
	companionState?: "idle" | "running" | "awaiting-approval" | "error" | "done" | "cancelled";
	phase?: string;
	executorKind?: "local" | "remote" | "unknown";
	unread?: boolean;
	usageCost?: string;
};

export type AmpTopSnapshot = {
	connection: "connecting" | "live" | "offline";
	companionConnected?: boolean;
	threads: AmpTopThread[];
};

type SnapshotListener = (snapshot: AmpTopSnapshot) => void;

const restartDelayMs = 3000;

export class AmpTopSource {
	private child: ChildProcessWithoutNullStreams | undefined;
	private listener: SnapshotListener | undefined;
	private restartTimer: NodeJS.Timeout | undefined;
	private snapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };
	private started = false;

	onSnapshot(listener: SnapshotListener): void {
		this.listener = listener;
		listener(this.snapshot);
	}

	start(): void {
		if (this.started) {
			return;
		}

		this.started = true;
		this.launch();
	}

	stop(): void {
		this.started = false;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}

		const child = this.child;
		this.child = undefined;
		child?.kill();
	}

	private launch(): void {
		this.update({ ...this.snapshot, connection: "connecting" });

		const child = spawn(resolveAmpCommand(), ["top", "--stream-jsonl"], {
			windowsHide: true,
			env: { ...process.env, AMP_DECK_DISABLE_COMPANION: "1" },
		});
		this.child = child;

		let stdoutBuffer = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (!this.started || this.child !== child) return;
			stdoutBuffer += chunk;
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!this.started || this.child !== child) return;
				const snapshot = parseSnapshot(line);
				if (snapshot) {
					this.update(snapshot);
				}
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = `${stderr}${chunk}`.slice(-1000);
		});
		child.once("error", (error) => {
			if (this.child !== child) {
				return;
			}

			this.child = undefined;
			streamDeck.logger.error(`Unable to start Amp status source: ${error.message}`);
			this.scheduleRestart();
		});
		child.once("close", (code) => {
			if (this.child !== child) {
				return;
			}

			this.child = undefined;
			if (stderr.trim()) {
				streamDeck.logger.warn(`Amp status source exited (${code ?? "unknown"}): ${stderr.trim()}`);
			}
			this.scheduleRestart();
		});
	}

	private scheduleRestart(): void {
		this.update({ ...this.snapshot, connection: "offline" });
		if (!this.started || this.restartTimer) {
			return;
		}

		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			if (this.started) {
				this.launch();
			}
		}, restartDelayMs);
		this.restartTimer.unref();
	}

	private update(snapshot: AmpTopSnapshot): void {
		this.snapshot = snapshot;
		this.listener?.(snapshot);
	}
}

function parseSnapshot(line: string): AmpTopSnapshot | undefined {
	try {
		const value: unknown = JSON.parse(line);
		if (!isRecord(value) || !Array.isArray(value.threads)) {
			return undefined;
		}

		const threads = value.threads.flatMap((thread): AmpTopThread[] => {
			if (!isRecord(thread) || typeof thread.id !== "string") {
				return [];
			}

			return [
				{
					id: thread.id,
					title: typeof thread.title === "string" ? thread.title : thread.id,
					url: typeof thread.url === "string" ? thread.url : undefined,
					project: typeof thread.project === "string" ? thread.project : undefined,
					updatedAt: typeof thread.updatedAt === "string" ? thread.updatedAt : undefined,
					working: thread.working === true,
					executorConnected: thread.executorConnected === true,
				},
			];
		});

		return {
			connection: value.reconnecting === true ? "connecting" : "live",
			threads,
		};
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
