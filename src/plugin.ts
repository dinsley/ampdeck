import streamDeck from "@elgato/streamdeck";

import { ArchiveThread, ReviewThread, ShipThread } from "./actions/cli-thread-command";
import { EncoderStatus } from "./actions/encoder-status";
import { OpenThread } from "./actions/open-thread";
import { PuckVariation } from "./actions/puck-variation";
import { ThreadStore } from "./state/thread-store";

const threadStore = new ThreadStore();

streamDeck.actions.registerAction(new EncoderStatus(threadStore));
streamDeck.actions.registerAction(new OpenThread(threadStore));
streamDeck.actions.registerAction(new PuckVariation());
streamDeck.actions.registerAction(new ShipThread(threadStore));
streamDeck.actions.registerAction(new ArchiveThread(threadStore));
streamDeck.actions.registerAction(new ReviewThread(threadStore));

void streamDeck.connect();

let shuttingDown = false;
function shutdown(): void {
	if (shuttingDown) return;
	shuttingDown = true;
	threadStore.dispose();
	process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
