import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	AmpCliManager,
	compareAmpVersions,
	minimumAmpVersion,
	parseExecutableSetting,
	type ExecutableSetting,
} from "../src/amp/amp-cli-manager.ts";

const capabilityOutput = [
	"--no-color",
	"--execute",
	"--stream-json",
	"--stream-jsonl",
	"--json",
	"--limit",
	"usage",
	"export",
	"continue",
	"archive",
].join(" ");

describe("Amp CLI compatibility", () => {
	it("compares numeric version components and ignores build suffixes", () => {
		assert.equal(compareAmpVersions(`${minimumAmpVersion}-ga5b614`, minimumAmpVersion), 0);
		assert.equal(compareAmpVersions("0.0.1785170480", minimumAmpVersion), -1);
		assert.equal(compareAmpVersions("0.1.0", minimumAmpVersion), 1);
	});

	it("treats an absent setting as automatic and rejects malformed persisted settings", () => {
		assert.deepEqual(parseExecutableSetting(undefined), { mode: "automatic" });
		assert.throws(() => parseExecutableSetting({ mode: "custom", path: "" }), /invalid/u);
		assert.throws(() => parseExecutableSetting({ mode: "future" }), /invalid/u);
	});

	it("fails closed until every compatibility probe passes", async () => {
		const settings = memorySettings({ mode: "automatic" });
		const manager = new AmpCliManager(settings, (_command, args) => {
			if (args[0] === "--version") return Promise.resolve(`amp ${minimumAmpVersion}\n`);
			if (args.includes("--json")) return Promise.resolve("[]");
			return Promise.resolve(args[0] === "top" ? "top help without the required flag" : capabilityOutput);
		});

		assert.equal(manager.state.status, "loading");
		await assert.rejects(manager.run(["threads", "list"]), /preflight/u);
		const state = await manager.initialize();
		assert.equal(state.status, "blocked");
		assert.equal(state.status === "blocked" ? state.failure.kind : undefined, "missing-capability");
		await assert.rejects(manager.run(["threads", "list"]), /preflight/u);
	});

	it("tests a custom executable before saving or activating it", async () => {
		const settings = memorySettings({ mode: "automatic" });
		let rejectCustom = true;
		const commands: string[] = [];
		const manager = new AmpCliManager(settings, (command, args) => {
			commands.push(command);
			if (args[0] === "--version")
				return Promise.resolve(`amp ${command === process.execPath && rejectCustom ? "0.0.1" : minimumAmpVersion}\n`);
			if (args.includes("--json")) return Promise.resolve("[]");
			if (args[0] === "probe-after-failure") return Promise.resolve("working");
			return Promise.resolve(capabilityOutput);
		});

		assert.equal((await manager.initialize()).status, "compatible");
		const rejected = await manager.setExecutable({ mode: "custom", path: process.execPath });
		assert.equal(rejected.status, "blocked");
		assert.equal(rejected.status === "blocked" ? rejected.failure.kind : undefined, "unsupported-version");
		assert.deepEqual(settings.current(), { mode: "automatic" });
		assert.equal(manager.state.status, "compatible");
		assert.equal(manager.state.status === "compatible" ? manager.state.source : undefined, "automatic");
		assert.equal(await manager.run(["probe-after-failure"]), "working");

		rejectCustom = false;
		const accepted = await manager.setExecutable({ mode: "custom", path: process.execPath });
		assert.equal(accepted.status, "compatible");
		assert.deepEqual(settings.current(), { mode: "custom", path: process.execPath });
		await manager.run(["probe-after-success"]);
		assert.equal(commands.at(-1), process.execPath);
		if (process.platform !== "win32") {
			const foreignPath = await manager.setExecutable({ mode: "custom", path: String.raw`C:\tools\amp.exe` });
			assert.equal(foreignPath.status === "blocked" ? foreignPath.failure.kind : undefined, "invalid-settings");
			assert.deepEqual(settings.current(), { mode: "custom", path: process.execPath });
		}
	});

	it("keeps executable changes single-flight", async () => {
		const settings = memorySettings({ mode: "automatic" });
		let releaseAutomatic: (() => void) | undefined;
		const automaticVersion = new Promise<void>((resolve) => {
			releaseAutomatic = resolve;
		});
		const manager = new AmpCliManager(settings, async (command, args) => {
			if (args[0] === "--version") {
				if (command !== process.execPath) await automaticVersion;
				return `amp ${minimumAmpVersion}\n`;
			}
			if (args.includes("--json")) return "[]";
			return capabilityOutput;
		});

		const oldPreflight = manager.initialize();
		const replacement = await manager.setExecutable({ mode: "custom", path: process.execPath });
		assert.equal(replacement.status, "blocked");
		assert.match(replacement.status === "blocked" ? replacement.failure.message : "", /already running/u);
		releaseAutomatic?.();
		await oldPreflight;
		assert.equal(manager.state.status === "compatible" ? manager.state.source : undefined, "automatic");
		assert.deepEqual(settings.current(), { mode: "automatic" });
	});

	it("rejects command output produced after the executable revision changes", async () => {
		const settings = memorySettings({ mode: "automatic" });
		let releaseCommand: (() => void) | undefined;
		const commandPending = new Promise<void>((resolve) => {
			releaseCommand = resolve;
		});
		const manager = new AmpCliManager(settings, async (_command, args) => {
			if (args[0] === "obsolete-command") {
				await commandPending;
				return "obsolete";
			}
			if (args[0] === "--version") return `amp ${minimumAmpVersion}\n`;
			if (args.includes("--json")) return "[]";
			return capabilityOutput;
		});

		await manager.initialize();
		const command = manager.run(["obsolete-command"]);
		await manager.recheck();
		releaseCommand?.();
		await assert.rejects(command, /changed while command was running/u);
	});
});

function memorySettings(initial: ExecutableSetting) {
	let setting = initial;
	return {
		loadExecutableSetting: () => Promise.resolve(setting),
		saveExecutableSetting: (next: ExecutableSetting) => {
			setting = next;
			return Promise.resolve();
		},
		current: () => setting,
	};
}
