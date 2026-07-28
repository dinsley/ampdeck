import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { launchAmpCommand, parseAmpVersion, resolveAmpCommand } from "./amp-command";
import { parseThreadMetadataList } from "./amp-threads-model";

export const minimumAmpVersion = "0.0.1785170481";
export type ExecutableSetting = { mode: "automatic" } | { mode: "custom"; path: string };
export type PreflightPhase = "settings" | "resolve" | "version" | "capabilities" | "authentication";
export type AmpCliFailureKind =
	| "invalid-settings"
	| "missing-executable"
	| "not-executable"
	| "unsupported-version"
	| "missing-capability"
	| "authentication"
	| "schema-mismatch"
	| "timeout"
	| "transient"
	| "unknown";
export type AmpCliFailure = { kind: AmpCliFailureKind; message: string };
export type AmpCliState =
	| { status: "loading"; revision: number }
	| { status: "checking"; revision: number; source: ExecutableSetting["mode"]; phase: PreflightPhase }
	| { status: "compatible"; revision: number; source: ExecutableSetting["mode"]; version: string }
	| { status: "blocked"; revision: number; source: ExecutableSetting["mode"]; failure: AmpCliFailure };

type Runner = (command: string, args: string[], timeout: number, max: number) => Promise<string>;
export interface ExecutableSettingsAccess {
	loadExecutableSetting(): Promise<ExecutableSetting>;
	saveExecutableSetting(setting: ExecutableSetting): Promise<void>;
}

export class AmpCliManager {
	private command: string | undefined;
	private listeners = new Set<(state: AmpCliState) => void>();
	private operation: Promise<AmpCliState> | undefined;
	private revision = 0;
	state: AmpCliState = { status: "loading", revision: 0 };

	constructor(
		private readonly settings: ExecutableSettingsAccess,
		private readonly runner: Runner = runFile,
	) {}

	subscribe(listener: (state: AmpCliState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	initialize(): Promise<AmpCliState> {
		return this.recheck();
	}

	getExecutableSetting(): Promise<ExecutableSetting> {
		return this.settings.loadExecutableSetting();
	}

	recheck(): Promise<AmpCliState> {
		if (this.operation) return this.operation;
		const revision = ++this.revision;
		this.command = undefined;
		this.publish({ status: "checking", revision, source: "automatic", phase: "settings" });
		return this.track(
			this.settings
				.loadExecutableSetting()
				.then((setting) => this.activate(setting, revision))
				.catch((error: unknown) => this.block(revision, "automatic", error)),
		);
	}

	setExecutable(setting: ExecutableSetting): Promise<AmpCliState> {
		if (this.operation) {
			return Promise.resolve({
				status: "blocked",
				revision: this.revision,
				source: setting.mode,
				failure: publicFailure("transient", "Another Amp compatibility check is already running."),
			});
		}
		const operation = this.changeExecutable(setting);
		return this.track(operation);
	}

	private async changeExecutable(setting: ExecutableSetting): Promise<AmpCliState> {
		const previousState = this.state;
		const previousCommand = this.command;
		const revision = ++this.revision;
		this.command = undefined;
		try {
			const result = await this.probe(setting, revision);
			this.checkCurrent(revision);
			await this.settings.saveExecutableSetting(setting);
			this.checkCurrent(revision);
			this.command = result.command;
			return this.publish({
				status: "compatible",
				revision,
				source: setting.mode,
				version: result.version,
			});
		} catch (error) {
			if (revision !== this.revision) return this.state;
			const blocked: AmpCliState = {
				status: "blocked",
				revision,
				source: setting.mode,
				failure: classifyFailure(error),
			};
			if (previousState.status === "compatible" && previousCommand) {
				this.command = previousCommand;
				this.publish({ ...previousState, revision });
			} else {
				this.publish(blocked);
			}
			return blocked;
		}
	}

	run(args: string[], timeout = 30_000, maximumOutputBytes = 2 * 1024 * 1024): Promise<string> {
		const state = this.state;
		const command = this.command;
		if (state.status !== "compatible" || !command)
			return Promise.reject(new Error("Amp compatibility preflight has not passed"));
		return this.runner(command, args, timeout, maximumOutputBytes)
			.catch((error: unknown) => {
				throw new Error(classifyFailure(error).message);
			})
			.then((output) => {
				if (this.revision !== state.revision || this.state.status !== "compatible")
					throw new Error("Amp executable changed while command was running");
				return output;
			});
	}

	spawn(args: string[]): ChildProcessWithoutNullStreams {
		if (this.state.status !== "compatible" || !this.command)
			throw new Error("Amp compatibility preflight has not passed");
		return spawn(this.command, args, { env: { ...process.env, NO_COLOR: "1" }, windowsHide: true });
	}

	launch(args: string[], threadId: string): Promise<void> {
		const state = this.state;
		const command = this.command;
		if (state.status !== "compatible" || !command)
			return Promise.reject(new Error("Amp compatibility preflight has not passed"));
		return launchAmpCommand(args, threadId, { command, logFailures: false })
			.catch((error: unknown) => {
				throw new Error(classifyFailure(error).message);
			})
			.then(() => {
				if (this.revision !== state.revision || this.state.status !== "compatible")
					throw new Error("Amp executable changed while command was running");
			});
	}

	private async activate(setting: ExecutableSetting, revision: number): Promise<AmpCliState> {
		try {
			const result = await this.probe(setting, revision);
			this.checkCurrent(revision);
			this.command = result.command;
			return this.publish({ status: "compatible", revision, source: setting.mode, version: result.version });
		} catch (error) {
			return this.block(revision, setting.mode, error);
		}
	}

	private async probe(setting: ExecutableSetting, revision: number): Promise<{ command: string; version: string }> {
		this.checkCurrent(revision);
		this.publish({ status: "checking", revision, source: setting.mode, phase: "resolve" });
		const command = setting.mode === "custom" ? await validateCustom(setting.path) : resolveAmpCommand();
		this.checkCurrent(revision);
		this.publish({ status: "checking", revision, source: setting.mode, phase: "version" });
		const version = parseAmpVersion(await this.runner(command, ["--version"], 5_000, 16_384));
		if (!version) throw failure("schema-mismatch", "Amp returned an unrecognized version response.");
		if (compareAmpVersions(version, minimumAmpVersion) < 0)
			throw failure("unsupported-version", `Amp ${minimumAmpVersion} or newer is required.`);
		this.checkCurrent(revision);
		this.publish({ status: "checking", revision, source: setting.mode, phase: "capabilities" });
		for (const probe of capabilityProbes) {
			const output = await this.runner(command, probe.args, 5_000, 128 * 1024);
			this.checkCurrent(revision);
			if (!probe.required.every((word) => output.includes(word)))
				throw failure("missing-capability", "Amp is missing a required command capability.");
		}
		this.publish({ status: "checking", revision, source: setting.mode, phase: "authentication" });
		const response = await this.runner(
			command,
			["--no-color", "threads", "list", "--json", "--limit", "1"],
			8_000,
			256 * 1024,
		);
		this.checkCurrent(revision);
		if (!parseThreadMetadataList(response))
			throw failure("schema-mismatch", "Amp returned an unrecognized thread response.");
		return { command, version };
	}

	private block(revision: number, source: ExecutableSetting["mode"], error: unknown): AmpCliState {
		if (revision !== this.revision) return this.state;
		this.command = undefined;
		return this.publish({ status: "blocked", revision, source, failure: classifyFailure(error) });
	}

	private track(operation: Promise<AmpCliState>): Promise<AmpCliState> {
		this.operation = operation;
		void operation.then(
			() => {
				if (this.operation === operation) this.operation = undefined;
			},
			() => {
				if (this.operation === operation) this.operation = undefined;
			},
		);
		return operation;
	}

	private checkCurrent(revision: number): void {
		if (revision !== this.revision) throw new Error("stale preflight");
	}
	private publish<T extends AmpCliState>(state: T): T {
		this.state = state;
		for (const listener of this.listeners) listener(state);
		return state;
	}
}

const capabilityProbes = [
	{ args: ["--help"], required: ["--no-color", "--execute", "--stream-json"] },
	{ args: ["top", "--help"], required: ["--stream-jsonl"] },
	{ args: ["threads", "list", "--help"], required: ["--json", "--limit"] },
	{ args: ["threads", "usage", "--help"], required: ["usage"] },
	{ args: ["threads", "export", "--help"], required: ["export"] },
	{ args: ["threads", "continue", "--help"], required: ["continue"] },
	{ args: ["threads", "archive", "--help"], required: ["archive"] },
];

export function parseExecutableSetting(value: unknown): ExecutableSetting {
	if (value === undefined) return { mode: "automatic" };
	if (typeof value === "object" && value !== null && "mode" in value) {
		if (value.mode === "automatic") return { mode: "automatic" };
		if (value.mode === "custom" && "path" in value && typeof value.path === "string" && value.path.trim())
			return { mode: "custom", path: value.path };
	}
	throw failure("invalid-settings", "The saved Amp executable setting is invalid.");
}

export function compareAmpVersions(left: string, right: string): number {
	const parts = (value: string) =>
		value
			.split("-")[0]
			.split(".")
			.map((part) => BigInt(part));
	const a = parts(left),
		b = parts(right);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const delta = (a[index] ?? 0n) - (b[index] ?? 0n);
		if (delta) return delta > 0 ? 1 : -1;
	}
	return 0;
}

async function validateCustom(path: string): Promise<string> {
	if (!isAbsolute(path)) throw failure("invalid-settings", "The custom Amp executable must be an absolute path.");
	try {
		if (!(await stat(path)).isFile()) throw failure("not-executable", "The custom Amp executable is not a file.");
		await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
	} catch (error) {
		if (isFailure(error)) throw error;
		throw failure(
			(error as NodeJS.ErrnoException).code === "ENOENT" ? "missing-executable" : "not-executable",
			"The custom Amp executable cannot be used.",
		);
	}
	return path;
}

function runFile(command: string, args: string[], timeout: number, maxBuffer: number): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile(
			command,
			args,
			{ shell: false, timeout, maxBuffer, windowsHide: true, env: { ...process.env, NO_COLOR: "1" } },
			(error, stdout) => (error ? reject(asError(error)) : resolve(stdout)),
		),
	);
}
class AmpFailureError extends Error {
	constructor(
		readonly kind: AmpCliFailureKind,
		message: string,
	) {
		super(message);
	}
}
function failure(kind: AmpCliFailureKind, message: string): AmpFailureError {
	return new AmpFailureError(kind, message);
}
function isFailure(value: unknown): value is AmpCliFailure {
	return value instanceof AmpFailureError;
}
function classifyFailure(error: unknown): AmpCliFailure {
	if (isFailure(error)) return { kind: error.kind, message: error.message };
	const code = (error as NodeJS.ErrnoException)?.code;
	const text = String((error as Error)?.message ?? "").toLowerCase();
	if (code === "ENOENT") return publicFailure("missing-executable", "The Amp executable was not found.");
	if (code === "EACCES") return publicFailure("not-executable", "The Amp executable cannot be executed.");
	if (/timeout|timed out|etimedout/u.test(text))
		return publicFailure("timeout", "Amp did not respond before the timeout.");
	if (/auth|sign.?in|log.?in|unauthor/u.test(text))
		return publicFailure("authentication", "Amp authentication is unavailable.");
	if (/econn|network|temporar/u.test(text)) return publicFailure("transient", "Amp is temporarily unavailable.");
	return publicFailure("unknown", "Amp compatibility could not be verified.");
}

function publicFailure(kind: AmpCliFailureKind, message: string): AmpCliFailure {
	return { kind, message };
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error("Amp operation failed");
}
