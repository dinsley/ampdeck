export type JsonValue = boolean | number | string | null | undefined | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface GlobalSettingsAdapter {
	getGlobalSettings(): Promise<unknown>;
	setGlobalSettings(settings: JsonObject): Promise<void>;
}

/** The sole whole-object global-settings writer. Mutations are committed in FIFO order. */
export class GlobalSettingsStore {
	private settings: JsonObject = {};
	private initialized: Promise<void> | undefined;
	private queue = Promise.resolve();

	constructor(private readonly adapter: GlobalSettingsAdapter) {}

	initialize(): Promise<void> {
		if (!this.initialized) {
			const operation = this.adapter
				.getGlobalSettings()
				.then((value) => {
					this.settings = isObject(value) ? { ...value } : {};
				})
				.catch((error: unknown) => {
					if (this.initialized === operation) this.initialized = undefined;
					throw error;
				});
			this.initialized = operation;
		}
		return this.initialized;
	}

	async read(): Promise<Readonly<JsonObject>> {
		await this.initialize();
		await this.queue;
		return { ...this.settings };
	}

	update(mutator: (settings: JsonObject) => void): Promise<void> {
		const operation = this.queue.then(async () => {
			await this.initialize();
			const next = { ...this.settings };
			mutator(next);
			await this.adapter.setGlobalSettings(next);
			this.settings = next;
		});
		this.queue = operation.catch(() => undefined);
		return operation;
	}
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
