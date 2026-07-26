import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import streamDeck from "@elgato/streamdeck";

import { resolveAmpCommand } from "./amp-command";
import { JsonlLineBuffer, parseSnapshot, type AmpTopSnapshot } from "./amp-top-model";

export type { AmpTopSnapshot, AmpTopThread } from "./amp-top-model";

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

		const stdout = new JsonlLineBuffer();
		let stderr = "";
		let schemaWarningLogged = false;
		const processLine = (line: string): void => {
			const snapshot = parseSnapshot(line);
			if (snapshot) {
				schemaWarningLogged = false;
				this.update(snapshot);
			} else {
				this.update({ ...this.snapshot, connection: "offline" });
				if (!schemaWarningLogged) {
					schemaWarningLogged = true;
					streamDeck.logger.warn("Amp status schema mismatch; controls are disabled until a valid snapshot arrives");
				}
			}
		};
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (!this.started || this.child !== child) return;
			for (const event of stdout.push(chunk)) {
				if (!this.started || this.child !== child) return;
				processLine(event.kind === "line" ? event.line : "");
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

			const finalLine = stdout.finish();
			if (finalLine) processLine(finalLine);
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
