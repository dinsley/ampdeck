import streamDeck, {
	action,
	KeyDownEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { isAmpThreadUrl } from "../amp/thread-url";
import { renderCommandFeedback, renderOpenThreadKey, type CommandFeedbackKind } from "../rendering/command-key";
import { ThreadStore } from "../state/thread-store";

@action({ UUID: "com.daniel-insley.amp-deck.open-thread" })
export class OpenThread extends SingletonAction {
	private readonly appearanceGenerations = new Map<string, number>();
	private readonly feedback = new Map<string, CommandFeedbackKind>();
	private readonly feedbackTimers = new Map<string, NodeJS.Timeout>();
	private readonly visibleActionIds = new Set<string>();
	private releaseStore: (() => void) | undefined;

	constructor(private readonly store: ThreadStore) {
		super();
		this.store.subscribe(() => {
			void this.renderVisibleActions().catch((error) => {
				streamDeck.logger.error(`Unable to render Open Thread action: ${getErrorMessage(error)}`);
			});
		});
	}

	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		this.appearanceGenerations.set(ev.action.id, (this.appearanceGenerations.get(ev.action.id) ?? 0) + 1);
		this.visibleActionIds.add(ev.action.id);
		this.releaseStore ??= this.store.acquire();
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.appearanceGenerations.set(ev.action.id, (this.appearanceGenerations.get(ev.action.id) ?? 0) + 1);
		this.feedback.delete(ev.action.id);
		const feedbackTimer = this.feedbackTimers.get(ev.action.id);
		if (feedbackTimer) clearTimeout(feedbackTimer);
		this.feedbackTimers.delete(ev.action.id);
		this.visibleActionIds.delete(ev.action.id);
		if (this.visibleActionIds.size === 0) {
			this.releaseStore?.();
			this.releaseStore = undefined;
		}
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		const thread = this.store.selectedThread;
		if (!thread?.url || !isAmpThreadUrl(thread.url)) {
			await this.showFeedback(ev.action, "unavailable");
			return;
		}

		const appearanceGeneration = this.appearanceGenerations.get(ev.action.id);
		try {
			await streamDeck.system.openUrl(thread.url);
			await this.showFeedback(ev.action, "success", appearanceGeneration);
		} catch (error) {
			streamDeck.logger.warn(`Unable to open selected thread: ${getErrorMessage(error)}`);
			await this.showFeedback(ev.action, "error", appearanceGeneration);
			if (
				this.visibleActionIds.has(ev.action.id) &&
				this.appearanceGenerations.get(ev.action.id) === appearanceGeneration
			) {
				await ev.action.showAlert();
			}
		}
	}

	private async showFeedback(
		action: KeyDownEvent["action"],
		kind: CommandFeedbackKind,
		expectedGeneration = this.appearanceGenerations.get(action.id),
	): Promise<void> {
		if (!this.visibleActionIds.has(action.id) || this.appearanceGenerations.get(action.id) !== expectedGeneration)
			return;
		const previousTimer = this.feedbackTimers.get(action.id);
		if (previousTimer) clearTimeout(previousTimer);
		this.feedback.set(action.id, kind);
		await action.setImage(renderCommandFeedback(kind));
		const timer = setTimeout(() => {
			this.feedbackTimers.delete(action.id);
			this.feedback.delete(action.id);
			if (this.visibleActionIds.has(action.id)) {
				void this.render(action).catch((error) => {
					streamDeck.logger.error(`Unable to restore Open Thread action: ${getErrorMessage(error)}`);
				});
			}
		}, 800);
		timer.unref();
		this.feedbackTimers.set(action.id, timer);
	}

	private async renderVisibleActions(): Promise<void> {
		await Promise.all(
			this.actions.map(async (action) => {
				if (action.isKey()) {
					await this.render(action);
				}
			}),
		);
	}

	private render(action: KeyDownEvent["action"]): Promise<void> {
		const feedback = this.feedback.get(action.id);
		if (feedback) return action.setImage(renderCommandFeedback(feedback));
		const thread = this.store.selectedThread;
		const canOpen = Boolean(thread?.url && isAmpThreadUrl(thread.url));
		return action.setImage(
			renderOpenThreadKey({
				title: thread?.title,
				dimmed: !canOpen,
			}),
		);
	}
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
