import streamDeck from "@elgato/streamdeck";

import { ArchiveThread, ReviewThread, ShipThread } from "./actions/cli-thread-command";
import { EncoderStatus } from "./actions/encoder-status";
import { OpenThread } from "./actions/open-thread";
import { ShowPuck } from "./actions/show-puck";
import { getErrorMessage } from "./error-message";
import { DiagnosticsController } from "./diagnostics/diagnostics-controller";
import { AmpCliManager } from "./amp/amp-cli-manager";
import { AmpTopSource } from "./amp/amp-top-source";
import { streamDeckExecutableSettings, streamDeckShippingStatePersistence } from "./state/shipping-persistence";
import { ThreadStore } from "./state/thread-store";

const logger = streamDeck.logger.createScope("Plugin");
const cliManager = new AmpCliManager(streamDeckExecutableSettings);
const threadStore = new ThreadStore({
	source: new AmpTopSource(cliManager),
	manager: cliManager,
	shippingPersistence: streamDeckShippingStatePersistence,
});
new DiagnosticsController(threadStore, cliManager);

streamDeck.actions.registerAction(new EncoderStatus(threadStore));
streamDeck.actions.registerAction(new OpenThread(threadStore));
streamDeck.actions.registerAction(new ShowPuck());
streamDeck.actions.registerAction(new ShipThread(threadStore));
streamDeck.actions.registerAction(new ArchiveThread(threadStore));
streamDeck.actions.registerAction(new ReviewThread(threadStore));

logger.info("Starting Amp Deck");
void streamDeck
	.connect()
	.then(async () => {
		logger.info("Connected to Stream Deck");
		await cliManager.initialize();
	})
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
