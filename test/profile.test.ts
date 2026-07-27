import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pluginDirectory = new URL("../com.dinsley.ampdeck.sdPlugin/", import.meta.url);

type ProfileAction = {
	Name: string;
	Settings: Record<string, unknown>;
	UUID: string;
};

type ProfilePage = {
	Controllers: Array<{
		Actions: Record<string, ProfileAction>;
		Type: "Encoder" | "Keypad";
	}>;
};

function profilePageDirectory(pageId: string): string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUV";
	const bytes = Buffer.from(pageId.replaceAll("-", ""), "hex");
	let accumulator = 0;
	let bits = 0;
	let encoded = "";

	for (const byte of bytes) {
		accumulator = (accumulator << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			encoded += alphabet[(accumulator >> bits) & 31];
			accumulator &= (1 << bits) - 1;
		}
	}

	if (bits > 0) {
		encoded += alphabet[(accumulator << (5 - bits)) & 31];
	}

	return `${encoded}Z`;
}

function readStoredZipEntries(path: URL): Map<string, Buffer> {
	const archive = readFileSync(path);
	const entries = new Map<string, Buffer>();
	const endOfDirectory = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	assert.notEqual(endOfDirectory, -1, "profile must be a ZIP archive");

	const entryCount = archive.readUInt16LE(endOfDirectory + 10);
	let offset = archive.readUInt32LE(endOfDirectory + 16);

	for (let index = 0; index < entryCount; index += 1) {
		assert.equal(archive.readUInt32LE(offset), 0x02014b50, "invalid ZIP directory entry");
		assert.equal(archive.readUInt16LE(offset + 10), 0, "profile entries must be stored");
		const compressedSize = archive.readUInt32LE(offset + 20);
		const nameLength = archive.readUInt16LE(offset + 28);
		const extraLength = archive.readUInt16LE(offset + 30);
		const commentLength = archive.readUInt16LE(offset + 32);
		const localOffset = archive.readUInt32LE(offset + 42);
		const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
		const localNameLength = archive.readUInt16LE(localOffset + 26);
		const localExtraLength = archive.readUInt16LE(localOffset + 28);
		const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
		entries.set(name, archive.subarray(dataOffset, dataOffset + compressedSize));
		offset += 46 + nameLength + extraLength + commentLength;
	}

	return entries;
}

describe("bundled Stream Deck+ profile", () => {
	it("is editable, installs without switching profiles, and targets only Stream Deck+", () => {
		const manifest = JSON.parse(readFileSync(new URL("manifest.json", pluginDirectory), "utf8")) as {
			Profiles: unknown;
		};

		assert.deepEqual(manifest.Profiles, [
			{
				Name: "profiles/stream-deck-plus",
				DeviceType: 7,
				AutoInstall: true,
				DontAutoSwitchWhenInstalled: true,
				Readonly: false,
			},
		]);
	});

	it("contains the recommended keys and all four Thread Status encoders", () => {
		const entries = readStoredZipEntries(new URL("profiles/stream-deck-plus.streamDeckProfile", pluginDirectory));
		const manifests = [...entries.entries()].filter(([name]) => name.endsWith("/manifest.json"));
		const profileManifest = manifests.find(([name]) => !name.includes("/Profiles/"));
		assert(profileManifest);
		const profile = JSON.parse(profileManifest[1].toString("utf8")) as {
			Device: { Model: string; UUID: string };
			Name: string;
			Pages: { Current: string; Default: string; Pages: string[] };
			Version: string;
		};
		assert.deepEqual(profile, {
			Device: { Model: "20GBD9901", UUID: "" },
			Name: "Amp Deck — Stream Deck+",
			Pages: {
				Current: "a5c36645-83d1-4f81-b8d9-22201605717b",
				Default: "e812d72c-bdcd-4d91-92a1-ff38d1fe416a",
				Pages: ["a5c36645-83d1-4f81-b8d9-22201605717b"],
			},
			Version: "2.0",
		});
		const profileRoot = profileManifest[0].slice(0, -"manifest.json".length);
		assert(
			entries.has(`${profileRoot}Profiles/${profilePageDirectory(profile.Pages.Current)}/manifest.json`),
			"current page directory must match its encoded UUID",
		);
		assert(
			entries.has(`${profileRoot}Profiles/${profilePageDirectory(profile.Pages.Default)}/manifest.json`),
			"default page directory must match its encoded UUID",
		);

		const pages = manifests
			.filter(([name]) => name.includes("/Profiles/"))
			.map(([, contents]) => JSON.parse(contents.toString("utf8")) as ProfilePage);
		const page = pages.find(({ Controllers }) => Controllers.some(({ Actions }) => Object.keys(Actions).length > 0));
		assert(page);
		const keypad = page.Controllers.find(({ Type }) => Type === "Keypad");
		const encoder = page.Controllers.find(({ Type }) => Type === "Encoder");
		assert(keypad);
		assert(encoder);

		assert.deepEqual(
			Object.fromEntries(Object.entries(keypad.Actions).map(([coordinate, action]) => [coordinate, action.UUID])),
			{
				"0,1": "com.dinsley.ampdeck.open-thread",
				"1,1": "com.dinsley.ampdeck.archive",
				"2,1": "com.dinsley.ampdeck.review-thread",
				"3,1": "com.dinsley.ampdeck.ship",
			},
		);
		assert.deepEqual(Object.keys(encoder.Actions), ["0,0", "1,0", "2,0", "3,0"]);
		for (const action of Object.values(encoder.Actions)) {
			assert.equal(action.UUID, "com.dinsley.ampdeck.status");
			assert.deepEqual(action.Settings, {});
		}
		assert.equal(
			Object.values(keypad.Actions).some(({ UUID }) => UUID === "com.dinsley.ampdeck.show-puck"),
			false,
		);
	});
});
