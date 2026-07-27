import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
const bundledPackages = ["@elgato/streamdeck", "@elgato/schemas", "@elgato/utils", "zod", "ws", "entities", "tslib"];

describe("third-party notices", () => {
	it("lists the installed version of every bundled package", () => {
		for (const packageName of bundledPackages) {
			const packageJson = JSON.parse(
				readFileSync(new URL(`../node_modules/${packageName}/package.json`, import.meta.url), "utf8"),
			) as { version?: unknown };

			if (typeof packageJson.version !== "string") {
				assert.fail(`${packageName} package.json does not contain a string version`);
			}

			assert.ok(
				notices.includes(`\`${packageName}\` ${packageJson.version}`),
				`${packageName} ${packageJson.version} is missing from THIRD_PARTY_NOTICES.md`,
			);
		}
	});

	it("records the permitted Amp and Puck visual assets", () => {
		assert.match(notices, /Puck images, Puck icon, other Amp-derived iconography/);
		assert.match(notices, /redistributed with permission/);
	});
});
