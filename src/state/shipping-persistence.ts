import streamDeck from "@elgato/streamdeck";

import { parseExecutableSetting, type ExecutableSetting, type ExecutableSettingsAccess } from "../amp/amp-cli-manager";
import type { ShippingDispatchState } from "./thread-store-model";
import type { ShippingStatePersistence } from "./thread-store";
import { GlobalSettingsStore } from "./global-settings-store";

export const globalSettingsStore = new GlobalSettingsStore({
	getGlobalSettings: () => streamDeck.settings.getGlobalSettings(),
	setGlobalSettings: (settings) => streamDeck.settings.setGlobalSettings(settings),
});

export const streamDeckShippingStatePersistence: ShippingStatePersistence = {
	async load() {
		const value = (await globalSettingsStore.read()).shippingDispatches;
		return Array.isArray(value) ? value.filter(isShippingDispatchState) : [];
	},
	save(dispatches) {
		return globalSettingsStore.update((settings) => {
			settings.shippingDispatches = dispatches;
		});
	},
};

export const streamDeckExecutableSettings: ExecutableSettingsAccess = {
	async loadExecutableSetting() {
		return parseExecutableSetting((await globalSettingsStore.read()).ampExecutable);
	},
	saveExecutableSetting(setting: ExecutableSetting) {
		return globalSettingsStore.update((settings) => {
			settings.ampExecutable = setting;
		});
	},
};

function isShippingDispatchState(value: unknown): value is ShippingDispatchState {
	return (
		typeof value === "object" &&
		value !== null &&
		"threadId" in value &&
		"observedWorking" in value &&
		"expiresAt" in value &&
		typeof value.threadId === "string" &&
		typeof value.observedWorking === "boolean" &&
		typeof value.expiresAt === "number"
	);
}
