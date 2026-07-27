import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import streamDeck from "@elgato/streamdeck";

const maximumOutputBytes = 2 * 1024 * 1024;
const maximumErrorBytes = 4 * 1024;
const maximumAcceptanceRecordBytes = 1024 * 1024;
const commandAcceptanceTimeoutMs = 30_000;

type LaunchAmpCommandOptions = {
	command?: string;
	timeoutMs?: number;
	appendStreamJson?: boolean;
};

export function resolveAmpCommand(
	platform: NodeJS.Platform = process.platform,
	home: string = homedir(),
	fileExists: (path: string) => boolean = existsSync,
): string {
	const executableName = platform === "win32" ? "amp.exe" : "amp";
	const candidates = [join(home, ".amp", "bin", executableName)];

	if (platform === "darwin") {
		candidates.push("/opt/homebrew/bin/amp", "/usr/local/bin/amp");
	} else if (platform === "linux") {
		candidates.push(
			join(home, ".local", "bin", "amp"),
			"/home/linuxbrew/.linuxbrew/bin/amp",
			"/usr/local/bin/amp",
			"/usr/bin/amp",
		);
	}

	const executable = candidates.find(fileExists);
	if (executable) return executable;
	return "amp";
}

export function runAmpCommand(args: string[], timeoutMs = 30_000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			resolveAmpCommand(),
			args,
			{
				env: ampEnvironment(),
				maxBuffer: maximumOutputBytes,
				timeout: timeoutMs,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr.trim() || error.message));
					return;
				}
				resolve(stdout);
			},
		);
	});
}

export function launchAmpCommand(
	args: string[],
	threadId: string,
	options: LaunchAmpCommandOptions = {},
): Promise<void> {
	return new Promise((resolve, reject) => {
		const commandArgs = options.appendStreamJson === false ? args : [...args, "--stream-json"];
		const child = spawn(options.command ?? resolveAmpCommand(), commandArgs, {
			detached: true,
			env: ampEnvironment(),
			windowsHide: true,
		});
		let accepted = false;
		let settled = false;
		let stderr = "";
		let stdoutBuffer = "";
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			reject(new Error("Amp did not acknowledge the command within 30 seconds"));
		}, options.timeoutMs ?? commandAcceptanceTimeoutMs);
		timer.unref();

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdin.end();
		child.stdout.on("data", (chunk: string) => {
			if (accepted || settled) return;
			stdoutBuffer += chunk;
			if (Buffer.byteLength(stdoutBuffer) > maximumAcceptanceRecordBytes) {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					child.kill();
					reject(new Error("Amp returned an oversized response before acknowledging the command"));
				}
				return;
			}
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!accepted && isAcceptedUserRecord(line, threadId)) {
					accepted = true;
					settled = true;
					clearTimeout(timer);
					child.unref();
					resolve();
				}
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = `${stderr}${chunk}`.slice(-maximumErrorBytes);
		});
		child.once("error", (error) => {
			clearTimeout(timer);
			if (!settled) {
				settled = true;
				reject(error);
			} else {
				streamDeck.logger.warn(`Accepted Amp command later failed: ${error.message}`);
			}
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			if (!settled && stdoutBuffer && isAcceptedUserRecord(stdoutBuffer, threadId)) {
				accepted = true;
				settled = true;
				resolve();
			}
			const errorDetail = stderr.trim();
			if (!settled) {
				settled = true;
				reject(new Error(errorDetail || `Amp exited before accepting the command (${code ?? "unknown"})`));
			} else if (accepted && code !== 0) {
				streamDeck.logger.warn(
					`Accepted Amp command later exited (${code ?? "unknown"})${errorDetail ? `: ${errorDetail}` : ""}`,
				);
			}
		});
	});
}

export function isAcceptedUserRecord(line: string, threadId: string): boolean {
	try {
		const value: unknown = JSON.parse(line);
		return isRecord(value) && value.type === "user" && value.session_id === threadId;
	} catch {
		return false;
	}
}

export function parseThreadUsageCost(output: string): string | undefined {
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => /^[$€£]\s?\d/.test(line))
		?.slice(0, 20);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function ampEnvironment(): NodeJS.ProcessEnv {
	return { ...process.env, NO_COLOR: "1" };
}
