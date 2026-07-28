import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GlobalSettingsStore, type JsonObject } from "../src/state/global-settings-store.ts";

describe("global settings store", () => {
	it("serializes whole-object updates without losing unrelated keys", async () => {
		let persisted: JsonObject = { unknown: "preserved" };
		const writes: JsonObject[] = [];
		const store = new GlobalSettingsStore({
			getGlobalSettings: () => Promise.resolve(persisted),
			setGlobalSettings: async (settings) => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				persisted = { ...settings };
				writes.push(persisted);
			},
		});

		await Promise.all([
			store.update((settings) => {
				settings.ampExecutable = { mode: "automatic" };
			}),
			store.update((settings) => {
				settings.shippingDispatches = [{ threadId: "T-one" }];
			}),
		]);

		assert.equal(writes.length, 2);
		assert.deepEqual(await store.read(), {
			unknown: "preserved",
			ampExecutable: { mode: "automatic" },
			shippingDispatches: [{ threadId: "T-one" }],
		});
	});

	it("continues processing later writes after an adapter failure", async () => {
		let attempts = 0;
		const store = new GlobalSettingsStore({
			getGlobalSettings: () => Promise.resolve({}),
			setGlobalSettings: () => {
				if (++attempts === 1) return Promise.reject(new Error("write failed"));
				return Promise.resolve();
			},
		});

		await assert.rejects(
			store.update((settings) => {
				settings.first = true;
			}),
			/write failed/u,
		);
		await store.update((settings) => {
			settings.second = true;
		});
		assert.deepEqual(await store.read(), { second: true });
	});

	it("retries initialization after a transient adapter failure", async () => {
		let attempts = 0;
		const store = new GlobalSettingsStore({
			getGlobalSettings: () =>
				++attempts === 1 ? Promise.reject(new Error("read failed")) : Promise.resolve({ recovered: true }),
			setGlobalSettings: () => Promise.resolve(),
		});

		await assert.rejects(store.read(), /read failed/u);
		assert.deepEqual(await store.read(), { recovered: true });
	});
});
