import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const maximumOutputBytes = 64 * 1024;

export function resolveAmpCommand(): string {
	if (process.platform === "win32" && process.env.USERPROFILE) {
		const executable = join(process.env.USERPROFILE, ".amp", "bin", "amp.exe");
		if (existsSync(executable)) return executable;
	}
	return "amp";
}

export function runAmpCommand(args: string[], timeoutMs = 30_000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(resolveAmpCommand(), args, {
			env: ampEnvironment(),
			maxBuffer: maximumOutputBytes,
			timeout: timeoutMs,
			windowsHide: true,
		}, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

export function launchAmpCommand(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(resolveAmpCommand(), args, {
			detached: true,
			env: ampEnvironment(),
			stdio: "ignore",
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

export function parseThreadUsageCost(output: string): string | undefined {
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => /^[$€£]\s?\d/.test(line))
		?.slice(0, 20);
}

function ampEnvironment(): NodeJS.ProcessEnv {
	return { ...process.env, AMP_DECK_DISABLE_COMPANION: "1", NO_COLOR: "1" };
}
