import streamDeck from "@elgato/streamdeck";

import { getErrorMessage } from "../error-message";
import type { ShippingDispatchState } from "./thread-store-model";
import type { ShippingStatePersistence } from "./thread-store";

type AmpDeckGlobalSettings = {
	[key: string]: boolean | number | string | null | undefined | AmpDeckGlobalSettings | AmpDeckGlobalSettings[];
	shippingDispatches?: AmpDeckGlobalSettings[];
};

export const streamDeckShippingStatePersistence: ShippingStatePersistence = {
	async load(): Promise<ShippingDispatchState[]> {
		try {
			const settings = await streamDeck.settings.getGlobalSettings<AmpDeckGlobalSettings>();
			return Array.isArray(settings.shippingDispatches)
				? settings.shippingDispatches.filter(isShippingDispatchState)
				: [];
		} catch (error) {
			streamDeck.logger.warn(`Unable to restore shipping state: ${getErrorMessage(error)}`);
			return [];
		}
	},

	async save(dispatches: ShippingDispatchState[]): Promise<void> {
		try {
			const settings = await streamDeck.settings.getGlobalSettings<AmpDeckGlobalSettings>();
			await streamDeck.settings.setGlobalSettings({
				...settings,
				shippingDispatches: dispatches,
			});
		} catch (error) {
			streamDeck.logger.warn(`Unable to persist shipping state: ${getErrorMessage(error)}`);
		}
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
