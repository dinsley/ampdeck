import streamDeck, {
	action,
	KeyDownEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { isAmpThreadUrl } from "../amp/thread-url";
import { getErrorMessage } from "../error-message";
import { renderCommandFeedback, renderOpenThreadKey, type CommandFeedbackKind } from "../rendering/command-key";
import { ThreadStore } from "../state/thread-store";
import { TemporaryFeedback } from "./temporary-feedback";

@action({ UUID: "com.daniel-insley.amp-deck.open-thread" })
export class OpenThread extends SingletonAction {
	private readonly feedback = new TemporaryFeedback<CommandFeedbackKind>();
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

		this.feedback.appear(ev.action.id);
		this.releaseStore ??= this.store.acquire();
		await this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.feedback.disappear(ev.action.id);
		if (this.feedback.visibleCount === 0) {
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

		const appearanceGeneration = this.feedback.generation(ev.action.id);
		try {
			await streamDeck.system.openUrl(thread.url);
			await this.showFeedback(ev.action, "success", appearanceGeneration);
		} catch (error) {
			streamDeck.logger.warn(`Unable to open selected thread: ${getErrorMessage(error)}`);
			await this.showFeedback(ev.action, "error", appearanceGeneration);
			if (this.feedback.isCurrent(ev.action.id, appearanceGeneration)) {
				await ev.action.showAlert();
			}
		}
	}

	private async showFeedback(
		action: KeyDownEvent["action"],
		kind: CommandFeedbackKind,
		expectedGeneration = this.feedback.generation(action.id),
	): Promise<void> {
		await this.feedback.show(
			action,
			kind,
			renderCommandFeedback(kind),
			() => this.render(action),
			(error) => streamDeck.logger.error(`Unable to restore Open Thread action: ${getErrorMessage(error)}`),
			expectedGeneration,
		);
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
