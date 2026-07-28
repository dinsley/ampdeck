import streamDeck, { DeviceType } from "@elgato/streamdeck";

import type { AmpCliFailure, AmpCliManager, ExecutableSetting } from "../amp/amp-cli-manager";
import { getErrorMessage } from "../error-message";
import { ThreadStore } from "../state/thread-store";
import { classifyDiagnosticError, formatDiagnosticsReport, type ClassifiedDiagnosticError } from "./diagnostics-model";

const troubleshootingUrl = "https://github.com/dinsley/ampdeck/blob/main/docs/troubleshooting.md";
const logger = streamDeck.logger.createScope("Diagnostics");

type InspectorRequest =
	| { type: "open-troubleshooting" | "refresh" | "request" | "test-connection" | "reset-executable" }
	| { type: "save-executable"; mode: "automatic" | "custom"; path?: string };

type ConnectionTest = {
	state: "idle" | "running" | "passed" | "failed";
	version?: string;
	error?: ReturnType<typeof classifyDiagnosticError>;
};

const deviceTypeNames: Record<number, string> = {
	[DeviceType.StreamDeck]: "Stream Deck",
	[DeviceType.StreamDeckMini]: "Stream Deck Mini",
	[DeviceType.StreamDeckXL]: "Stream Deck XL",
	[DeviceType.StreamDeckMobile]: "Stream Deck Mobile",
	[DeviceType.CorsairGKeys]: "Corsair GKeys",
	[DeviceType.StreamDeckPedal]: "Stream Deck Pedal",
	[DeviceType.CorsairVoyager]: "Corsair Voyager",
	[DeviceType.StreamDeckPlus]: "Stream Deck +",
	[DeviceType.SCUFController]: "SCUF Controller",
	[DeviceType.StreamDeckNeo]: "Stream Deck Neo",
	[DeviceType.StreamDeckStudio]: "Stream Deck Studio",
	[DeviceType.VirtualStreamDeck]: "Virtual Stream Deck",
	[DeviceType.Galleon100SD]: "Galleon 100 SD",
	[DeviceType.StreamDeckPlusXL]: "Stream Deck + XL",
};

export class DiagnosticsController {
	private connectionTest: ConnectionTest = { state: "idle" };
	private releaseMonitoring: (() => void) | undefined;
	private sendQueued = false;

	constructor(
		private readonly store: ThreadStore,
		private readonly manager: AmpCliManager,
	) {
		streamDeck.ui.onDidAppear(() => {
			this.releaseMonitoring ??= this.store.acquire();
			this.queueSend();
		});
		streamDeck.ui.onDidDisappear(() => {
			if (streamDeck.ui.action) return;
			this.releaseMonitoring?.();
			this.releaseMonitoring = undefined;
		});
		streamDeck.ui.onSendToPlugin<InspectorRequest>((event) => {
			if (!isInspectorRequest(event.payload)) return;
			if (event.payload.type === "refresh") {
				this.queueSend();
			} else if (event.payload.type === "test-connection") {
				this.testConnection();
			} else if (event.payload.type === "reset-executable") {
				void this.saveExecutable({ mode: "automatic" });
			} else if (event.payload.type === "save-executable") {
				const setting: ExecutableSetting =
					event.payload.mode === "custom" ? { mode: "custom", path: event.payload.path ?? "" } : { mode: "automatic" };
				void this.saveExecutable(setting);
			} else if (event.payload.type === "open-troubleshooting") {
				void streamDeck.system
					.openUrl(troubleshootingUrl)
					.catch((error: unknown) => logger.error(`Unable to open troubleshooting: ${getErrorMessage(error)}`));
			} else {
				this.queueSend();
			}
		});
		this.store.subscribeDiagnostics(() => this.queueSend());
		this.store.subscribe(() => this.queueSend());
		this.manager.subscribe(() => this.queueSend());
		streamDeck.devices.onDeviceDidChange(() => this.queueSend());
		streamDeck.devices.onDeviceDidConnect(() => this.queueSend());
		streamDeck.devices.onDeviceDidDisconnect(() => this.queueSend());
	}

	private testConnection(): void {
		if (this.connectionTest.state === "running") return;
		this.connectionTest = { state: "running" };
		this.queueSend();
		void this.manager
			.recheck()
			.then((state) => {
				this.connectionTest =
					state.status === "compatible"
						? { state: "passed", version: state.version }
						: {
								state: "failed",
								error:
									state.status === "blocked"
										? classifyCliFailure(state.failure)
										: classifyDiagnosticError("Preflight did not complete"),
							};
			})
			.catch((error: unknown) => {
				this.connectionTest = { state: "failed", error: classifyDiagnosticError(error) };
			})
			.finally(() => this.queueSend());
	}

	private async saveExecutable(setting: ExecutableSetting): Promise<void> {
		if (this.connectionTest.state === "running") return;
		this.connectionTest = { state: "running" };
		this.queueSend();
		try {
			const state = await this.manager.setExecutable(setting);
			this.connectionTest =
				state.status === "compatible"
					? { state: "passed", version: state.version }
					: {
							state: "failed",
							error:
								state.status === "blocked" ? classifyCliFailure(state.failure) : classifyDiagnosticError("preflight"),
						};
		} catch (error) {
			this.connectionTest = { state: "failed", error: classifyDiagnosticError(error) };
		} finally {
			this.queueSend();
		}
	}

	private queueSend(): void {
		if (this.sendQueued) return;
		this.sendQueued = true;
		queueMicrotask(() => {
			this.sendQueued = false;
			void this.send().catch((error: unknown) => {
				logger.error(`Unable to send diagnostics: ${getErrorMessage(error)}`);
			});
		});
	}

	private async send(): Promise<void> {
		if (!streamDeck.ui.action) return;
		const source = this.store.diagnostics;
		const cli = this.manager.state;
		const executable = await this.manager
			.getExecutableSetting()
			.catch((): ExecutableSetting => ({ mode: "automatic" }));
		const devices = streamDeck.devices
			.filter((device) => device.isConnected)
			.map((device) => deviceTypeNames[device.type] ?? `Unknown device (${device.type})`);
		const deviceSummary = [...new Set(devices)].join(", ") || "None connected";
		const commandState = this.store.commandAvailability;
		const lastCommandError = this.store.lastCommandError;
		const now = Date.now();
		const snapshotAge = source.lastValidSnapshotAt
			? `${Math.max(0, Math.floor((now - Date.parse(source.lastValidSnapshotAt)) / 1_000))} seconds`
			: "Unavailable";
		const fields: Array<readonly [string, string]> = [
			["Amp Deck version", streamDeck.info.plugin.version],
			["Build identifier", "Not available"],
			["Stream Deck software", streamDeck.info.application.version],
			["Plugin runtime", process.version],
			["Operating system", `${streamDeck.info.application.platform} ${streamDeck.info.application.platformVersion}`],
			["Connected device types", deviceSummary],
			["Amp executable source", "source" in cli ? cli.source : "automatic"],
			["Amp CLI version", cli.status === "compatible" ? cli.version : "Not available"],
			[
				"Compatibility preflight",
				cli.status === "checking"
					? `Checking: ${cli.phase}`
					: cli.status === "blocked"
						? `Blocked: ${cli.failure.kind}`
						: cli.status,
			],
			["Connection test", formatConnectionTest(this.connectionTest)],
			["Status source", source.statusSource],
			["Last valid snapshot", source.lastValidSnapshotAt ?? "Unavailable"],
			["Snapshot age", snapshotAge],
			["Consecutive failures", String(source.consecutiveFailures)],
			["Retry attempt", String(source.retryAttempt)],
			["Next retry", source.nextRetryAt ?? "Not scheduled"],
			["Schema compatibility", source.schemaCompatibility],
			["Last monitoring error", formatError(source.lastMonitoringError)],
			["Last command error", formatError(lastCommandError)],
			["Thread commands", capitalize(commandState.state)],
			["Command state reason", commandState.reason],
		];
		await streamDeck.ui.sendToPropertyInspector({
			type: "diagnostics",
			fields: fields.map(([label, value]) => ({ label, value })),
			report: formatDiagnosticsReport(fields),
			connectionTest: this.connectionTest,
			executable,
			preflight: cli,
			updatedAt: new Date().toISOString(),
		});
	}
}

function isInspectorRequest(value: unknown): value is InspectorRequest {
	if (typeof value !== "object" || value === null || !("type" in value)) return false;
	if (
		!["open-troubleshooting", "refresh", "request", "test-connection", "reset-executable", "save-executable"].includes(
			String(value.type),
		)
	)
		return false;
	if (value.type !== "save-executable") return true;
	return (
		"mode" in value &&
		(value.mode === "automatic" || (value.mode === "custom" && "path" in value && typeof value.path === "string"))
	);
}

function formatError(error: ReturnType<typeof classifyDiagnosticError> | undefined): string {
	return error ? `${error.kind}: ${error.message} (${error.occurredAt})` : "None";
}

function formatConnectionTest(test: ConnectionTest): string {
	if (test.state === "idle") return "Not run";
	if (test.state === "running") return "Running";
	if (test.state === "passed") return `Passed (Amp ${test.version ?? "version unavailable"})`;
	return `Failed: ${test.error?.kind ?? "unknown"}`;
}

function classifyCliFailure(failure: AmpCliFailure): ClassifiedDiagnosticError {
	const kinds: Record<AmpCliFailure["kind"], ClassifiedDiagnosticError["kind"]> = {
		"invalid-settings": "unknown",
		"missing-executable": "missing-cli",
		"not-executable": "missing-cli",
		"unsupported-version": "incompatible",
		"missing-capability": "incompatible",
		authentication: "authentication",
		"schema-mismatch": "schema-mismatch",
		timeout: "timeout",
		transient: "transient",
		unknown: "unknown",
	};
	return { kind: kinds[failure.kind], message: failure.message, occurredAt: new Date().toISOString() };
}

function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
