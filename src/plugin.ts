import streamDeck from "@elgato/streamdeck";

import { ArchiveThread, ReviewThread, ShipThread } from "./actions/cli-thread-command";
import { EncoderStatus } from "./actions/encoder-status";
import { OpenThread } from "./actions/open-thread";
import { ShowPuck } from "./actions/show-puck";
import { getErrorMessage } from "./error-message";
import { streamDeckShippingStatePersistence } from "./state/shipping-persistence";
import { ThreadStore } from "./state/thread-store";

const logger = streamDeck.logger.createScope("Plugin");
const threadStore = new ThreadStore({ shippingPersistence: streamDeckShippingStatePersistence });

streamDeck.actions.registerAction(new EncoderStatus(threadStore));
streamDeck.actions.registerAction(new OpenThread(threadStore));
streamDeck.actions.registerAction(new ShowPuck());
streamDeck.actions.registerAction(new ShipThread(threadStore));
streamDeck.actions.registerAction(new ArchiveThread(threadStore));
streamDeck.actions.registerAction(new ReviewThread(threadStore));

logger.info("Starting Amp Deck");
void streamDeck
	.connect()
	.then(() => logger.info("Connected to Stream Deck"))
	.catch((error: unknown) => {
		logger.error(`Unable to connect to Stream Deck: ${getErrorMessage(error)}`);
	});

let shuttingDown = false;
function shutdown(): void {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info("Stopping Amp Deck");
	threadStore.dispose();
	process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
