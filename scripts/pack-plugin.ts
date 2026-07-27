import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginDirectoryName = "com.daniel-insley.amp-deck.sdPlugin";
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = join(repositoryRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };

if (typeof packageJson.version !== "string") {
	throw new Error("package.json must contain a string version.");
}

let releaseVersion = packageJson.version;
let dryRun = false;

for (let index = 2; index < process.argv.length; index += 1) {
	const argument = process.argv[index];

	if (argument === "--dry-run") {
		dryRun = true;
		continue;
	}

	if (argument === "--version") {
		const value = process.argv[index + 1];
		if (value === undefined) {
			throw new Error("--version requires a value.");
		}

		releaseVersion = value;
		index += 1;
		continue;
	}

	throw new Error(`Unknown argument: ${argument}`);
}

if (!/^\d+\.\d+\.\d+$/u.test(releaseVersion)) {
	throw new Error(`Release version must use MAJOR.MINOR.PATCH format; received "${releaseVersion}".`);
}

const streamDeckVersion = `${releaseVersion}.0`;
const sourcePluginDirectory = join(repositoryRoot, pluginDirectoryName);
const noticesPath = join(repositoryRoot, "THIRD_PARTY_NOTICES.md");
const outputDirectory = join(repositoryRoot, "dist");
const stagingRoot = mkdtempSync(join(tmpdir(), "amp-deck-release-"));
const stagingPluginDirectory = join(stagingRoot, pluginDirectoryName);
const streamDeckCli = join(repositoryRoot, "node_modules", "@elgato", "cli", "bin", "streamdeck.mjs");

try {
	cpSync(sourcePluginDirectory, stagingPluginDirectory, { recursive: true });
	cpSync(noticesPath, join(stagingPluginDirectory, "THIRD_PARTY_NOTICES.md"));
	mkdirSync(outputDirectory, { recursive: true });

	const cliArguments = [
		streamDeckCli,
		"pack",
		stagingPluginDirectory,
		"--output",
		outputDirectory,
		"--version",
		streamDeckVersion,
		"--no-update-check",
	];

	if (dryRun) {
		cliArguments.push("--dry-run");
	} else {
		cliArguments.push("--force");
	}

	execFileSync(process.execPath, cliArguments, {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
} finally {
	rmSync(stagingRoot, { force: true, recursive: true });
}
