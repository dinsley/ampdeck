import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateCommandHold, getCommandKeyState } from "../src/actions/command-model.ts";
import { TemporaryFeedback } from "../src/actions/temporary-feedback.ts";

describe("command hold state", () => {
	const hold = { threadId: "T-one", selectionRevision: 4, startedAt: 100 };

	it("becomes ready only after the configured duration", () => {
		assert.equal(evaluateCommandHold(hold, "T-one", 4, 1_000, 1_099), "pending");
		assert.equal(evaluateCommandHold(hold, "T-one", 4, 1_000, 1_100), "ready");
	});

	it("invalidates immediately when the selected target changes", () => {
		assert.equal(evaluateCommandHold(hold, "T-two", 4, 1_000, 200), "invalidated");
		assert.equal(evaluateCommandHold(hold, "T-one", 5, 1_000, 200), "invalidated");
	});
});

describe("command key state", () => {
	const availableInput = {
		connection: "live" as const,
		hasThread: true,
		working: false,
		shipping: false,
		actionInFlight: false,
		threadInFlight: false,
		blocked: false,
		missingExecutor: false,
	};

	it("keeps the action identity visible while explaining unavailable states", () => {
		assert.deepEqual(getCommandKeyState({ ...availableInput, working: true }), {
			available: false,
			footer: "WORKING",
			loading: false,
		});
		assert.equal(getCommandKeyState({ ...availableInput, missingExecutor: true }).footer, "NO EXECUTOR");
		assert.equal(getCommandKeyState({ ...availableInput, hasThread: false }).footer, "SELECT THREAD");
		assert.equal(getCommandKeyState({ ...availableInput, connection: "offline" }).footer, "OFFLINE");
	});

	it("animates only the command actively being dispatched", () => {
		assert.deepEqual(getCommandKeyState({ ...availableInput, actionInFlight: true }), {
			available: false,
			footer: "BUSY",
			loading: true,
		});
		assert.deepEqual(getCommandKeyState({ ...availableInput, threadInFlight: true }), {
			available: false,
			footer: "BUSY",
			loading: false,
		});
		assert.deepEqual(getCommandKeyState(availableInput), {
			available: true,
			footer: "",
			loading: false,
		});
	});
});

describe("temporary action feedback", () => {
	it("restores the normal image after the feedback duration", async () => {
		const feedback = new TemporaryFeedback<string>();
		const action = { id: "action", setImage: () => Promise.resolve() };
		let restoreCount = 0;
		feedback.appear(action.id);

		await feedback.show(
			action,
			"sent",
			"image",
			() => {
				restoreCount += 1;
				return Promise.resolve();
			},
			(error) => {
				throw error;
			},
			feedback.generation(action.id),
			1,
		);
		await new Promise((resolve) => setTimeout(resolve, 5));

		assert.equal(feedback.get(action.id), undefined);
		assert.equal(restoreCount, 1);
		feedback.disappear(action.id);
	});

	it("does not schedule stale feedback restoration after an action disappears", async () => {
		const feedback = new TemporaryFeedback<string>();
		const imageSet = deferred<void>();
		const action = { id: "action", setImage: () => imageSet.promise };
		let restoreCount = 0;

		feedback.appear(action.id);
		const showing = feedback.show(
			action,
			"sent",
			"image",
			() => {
				restoreCount += 1;
				return Promise.resolve();
			},
			(error) => {
				throw error;
			},
			feedback.generation(action.id),
			1,
		);
		feedback.disappear(action.id);
		imageSet.resolve();
		await showing;
		await new Promise((resolve) => setTimeout(resolve, 5));

		assert.equal(feedback.get(action.id), undefined);
		assert.equal(restoreCount, 0);
	});

	it("clears feedback state when rendering the feedback image fails", async () => {
		const feedback = new TemporaryFeedback<string>();
		const action = { id: "action", setImage: () => Promise.reject(new Error("render failed")) };
		feedback.appear(action.id);

		await assert.rejects(
			feedback.show(
				action,
				"sent",
				"image",
				() => Promise.resolve(),
				() => undefined,
			),
			/render failed/,
		);
		assert.equal(feedback.get(action.id), undefined);
		feedback.disappear(action.id);
	});

	it("restores the current state when an older image request resolves last", async () => {
		const feedback = new TemporaryFeedback<string>();
		const firstImage = deferred<void>();
		let imageRequest = 0;
		let restoredValue: string | undefined;
		const action = {
			id: "action",
			setImage: () => {
				imageRequest += 1;
				return imageRequest === 1 ? firstImage.promise : Promise.resolve();
			},
		};
		const restore = (): Promise<void> => {
			restoredValue = feedback.get(action.id);
			return Promise.resolve();
		};
		feedback.appear(action.id);

		const firstShow = feedback.show(action, "sent", "first", restore, (error) => {
			throw error;
		});
		await feedback.show(action, "error", "second", restore, (error) => {
			throw error;
		});
		firstImage.resolve();
		await firstShow;

		assert.equal(feedback.get(action.id), "error");
		assert.equal(restoredValue, "error");
		feedback.disappear(action.id);
	});
});

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve: Deferred<T>["resolve"] = () => undefined;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}
