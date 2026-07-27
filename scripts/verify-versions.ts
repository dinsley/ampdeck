import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type PackageJson = {
	version?: unknown;
};

type Manifest = {
	Version?: unknown;
};

const repositoryRoot = resolve(import.meta.dirname, "..");
const packageJson = readJson<PackageJson>(resolve(repositoryRoot, "package.json"));
const manifest = readJson<Manifest>(resolve(repositoryRoot, "com.dinsley.ampdeck.sdPlugin", "manifest.json"));

if (typeof packageJson.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(packageJson.version)) {
	throw new Error("package.json version must use MAJOR.MINOR.PATCH format.");
}

const expectedManifestVersion = `${packageJson.version}.0`;
if (manifest.Version !== expectedManifestVersion) {
	throw new Error(
		`Version mismatch: package.json is ${packageJson.version}, so manifest.json must be ${expectedManifestVersion}.`,
	);
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}
