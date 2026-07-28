import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import streamDeck from "@elgato/streamdeck";

import type { AmpCliManager } from "./amp-cli-manager";
import { JsonlLineBuffer, parseSnapshot, type AmpTopSnapshot } from "./amp-top-model";
import {
	classifyDiagnosticError,
	initialAmpSourceDiagnostics,
	type AmpSourceDiagnostics,
} from "../diagnostics/diagnostics-model";

export type { AmpTopSnapshot, AmpTopThread } from "./amp-top-model";

type SnapshotListener = (snapshot: AmpTopSnapshot) => void;
type DiagnosticsListener = (diagnostics: AmpSourceDiagnostics) => void;

const restartDelayMs = 3000;
const logger = streamDeck.logger.createScope("AmpTop");

export class AmpTopSource {
	private child: ChildProcessWithoutNullStreams | undefined;
	private diagnostics: AmpSourceDiagnostics = initialAmpSourceDiagnostics;
	private diagnosticsListener: DiagnosticsListener | undefined;
	private listener: SnapshotListener | undefined;
	private restartTimer: NodeJS.Timeout | undefined;
	private snapshot: AmpTopSnapshot = { connection: "connecting", threads: [] };
	private started = false;

	constructor(private readonly manager?: Pick<AmpCliManager, "spawn" | "state" | "subscribe" | "recheck">) {
		manager?.subscribe((state) => {
			if (!this.started) return;
			if (this.restartTimer) clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
			const child = this.child;
			this.child = undefined;
			child?.kill();
			this.update({ ...this.snapshot, connection: state.status === "checking" ? "connecting" : "offline" });
			if (state.status === "compatible") this.launch();
		});
	}

	onSnapshot(listener: SnapshotListener): void {
		this.listener = listener;
		listener(this.snapshot);
	}

	onDiagnostics(listener: DiagnosticsListener): void {
		this.diagnosticsListener = listener;
		listener(this.diagnostics);
	}

	start(): void {
		if (this.started) {
			return;
		}

		this.started = true;
		this.updateDiagnostics({ statusSource: "connecting" });
		logger.info("Starting Amp status monitoring");
		if (!this.manager || this.manager.state.status === "compatible") this.launch();
	}

	stop(): void {
		const wasStarted = this.started;
		this.started = false;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}

		const child = this.child;
		this.child = undefined;
		child?.kill();
		this.updateDiagnostics({ statusSource: "paused", nextRetryAt: undefined });
		if (wasStarted) logger.info("Stopped Amp status monitoring");
	}

	private launch(): void {
		this.update({ ...this.snapshot, connection: "connecting" });
		this.updateDiagnostics({ statusSource: "connecting", nextRetryAt: undefined });

		logger.debug("Launching Amp status source");
		const child = this.manager
			? this.manager.spawn(["top", "--stream-jsonl"])
			: spawn("amp", ["top", "--stream-jsonl"], {
					windowsHide: true,
					env: { ...process.env, NO_COLOR: "1" },
				});
		this.child = child;

		const stdout = new JsonlLineBuffer();
		let stderr = "";
		let schemaWarningLogged = false;
		let processFailureRecorded = false;
		const processLine = (line: string): void => {
			const snapshot = parseSnapshot(line);
			if (snapshot) {
				schemaWarningLogged = false;
				processFailureRecorded = false;
				this.updateDiagnostics({
					statusSource: snapshot.connection,
					lastValidSnapshotAt: new Date().toISOString(),
					consecutiveFailures: 0,
					retryAttempt: 0,
					nextRetryAt: undefined,
					schemaCompatibility: "compatible",
					lastMonitoringError: undefined,
				});
				this.update(snapshot);
			} else {
				this.update({ ...this.snapshot, connection: "offline" });
				if (!processFailureRecorded) {
					processFailureRecorded = true;
					this.recordFailure(new Error("schema mismatch"), "mismatch");
				}
				if (!schemaWarningLogged) {
					schemaWarningLogged = true;
					logger.warn("Amp status schema mismatch; controls are disabled until a valid snapshot arrives");
				}
			}
		};
		child.stdin.end();
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
			logger.error("Unable to start Amp status source");
			if (!processFailureRecorded) this.recordFailure(error);
			if (this.manager) void this.manager.recheck();
			else this.scheduleRestart();
		});
		child.once("close", (code) => {
			if (this.child !== child) {
				return;
			}

			const finalLine = stdout.finish();
			if (finalLine) processLine(finalLine);
			this.child = undefined;
			if (!processFailureRecorded) {
				this.recordFailure(new Error(stderr.trim() || `Amp status source exited (${code ?? "unknown"})`));
			}
			logger.warn(`Amp status source exited (${code ?? "unknown"})`);
			this.scheduleRestart();
		});
	}

	private scheduleRestart(): void {
		this.update({ ...this.snapshot, connection: "offline" });
		if (!this.started || this.restartTimer || (this.manager && this.manager.state.status !== "compatible")) {
			return;
		}

		const nextRetryAt = new Date(Date.now() + restartDelayMs).toISOString();
		this.updateDiagnostics({
			statusSource: "offline",
			nextRetryAt,
			retryAttempt: this.diagnostics.retryAttempt + 1,
		});
		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			if (this.started) {
				this.launch();
			}
		}, restartDelayMs);
		this.restartTimer.unref();
		logger.debug(`Amp status source will retry in ${restartDelayMs}ms`);
	}

	private recordFailure(error: unknown, schemaCompatibility?: AmpSourceDiagnostics["schemaCompatibility"]): void {
		const consecutiveFailures = this.diagnostics.consecutiveFailures + 1;
		this.updateDiagnostics({
			statusSource: "offline",
			consecutiveFailures,
			schemaCompatibility: schemaCompatibility ?? this.diagnostics.schemaCompatibility,
			lastMonitoringError: classifyDiagnosticError(error),
		});
	}

	private updateDiagnostics(update: Partial<AmpSourceDiagnostics>): void {
		this.diagnostics = { ...this.diagnostics, ...update };
		this.diagnosticsListener?.(this.diagnostics);
	}

	private update(snapshot: AmpTopSnapshot): void {
		const previous = this.snapshot;
		this.snapshot = snapshot;
		if (snapshot.connection !== previous.connection) {
			if (snapshot.connection === "live") {
				logger.info(`Amp status is live with ${snapshot.threads.length} thread(s)`);
			} else if (snapshot.connection === "offline") {
				logger.warn("Amp status is offline");
			} else {
				logger.debug("Amp status is connecting");
			}
		} else if (snapshot.connection === "live" && snapshot.threads.length !== previous.threads.length) {
			logger.debug(`Amp status inventory now contains ${snapshot.threads.length} thread(s)`);
		}
		this.listener?.(snapshot);
	}
}
