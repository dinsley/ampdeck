import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type LockfilePackage = {
	dev?: boolean;
	version?: string;
};

type PackageLock = {
	packages?: Record<string, LockfilePackage>;
};

const repositoryRoot = resolve(import.meta.dirname, "..");
const readme = readFileSync(resolve(repositoryRoot, "README.md"), "utf8");
const lockfile = JSON.parse(readFileSync(resolve(repositoryRoot, "package-lock.json"), "utf8")) as PackageLock;

const runtimePackages = Object.entries(lockfile.packages ?? {})
	.filter(([path, metadata]) => path.includes("node_modules/") && metadata.dev !== true && metadata.version)
	.map(([path, metadata]) => ({
		name: path.split("node_modules/").at(-1),
		version: metadata.version,
	}))
	.filter((dependency): dependency is { name: string; version: string } => Boolean(dependency.name))
	.sort((left, right) => left.name.localeCompare(right.name));

if (runtimePackages.length === 0) {
	throw new Error("No bundled runtime packages were found in package-lock.json.");
}

const missingNotices = runtimePackages.filter(({ name, version }) => !readme.includes(`- \`${name}\` ${version} —`));
const documentedPackages = [...readme.matchAll(/^- `([^`]+)` ([^ ]+) —/gmu)].map((match) => ({
	name: match[1],
	version: match[2],
}));
const runtimeKeys = new Set(runtimePackages.map(({ name, version }) => `${name}@${version}`));
const staleNotices = documentedPackages.filter(({ name, version }) => !runtimeKeys.has(`${name}@${version}`));

if (missingNotices.length > 0 || staleNotices.length > 0) {
	throw new Error(
		[
			missingNotices.length > 0
				? `missing ${missingNotices.map(({ name, version }) => `${name} ${version}`).join(", ")}`
				: undefined,
			staleNotices.length > 0
				? `stale ${staleNotices.map(({ name, version }) => `${name} ${version}`).join(", ")}`
				: undefined,
		]
			.filter(Boolean)
			.join("; ")
			.replace(/^/u, "README third-party notices are "),
	);
}
