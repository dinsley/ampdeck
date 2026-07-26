import streamDeck from "@elgato/streamdeck";

import { ArchiveThread, ReviewThread } from "./actions/cli-thread-command";
import { EncoderStatus } from "./actions/encoder-status";
import { OpenThread } from "./actions/open-thread";
import { PuckVariation } from "./actions/puck-variation";
import { ShipThread } from "./actions/thread-command";
import { BridgeServer } from "./bridge/bridge-server";
import { ThreadStore } from "./state/thread-store";

const bridge = new BridgeServer();
const threadStore = new ThreadStore(bridge);

streamDeck.actions.registerAction(new EncoderStatus(threadStore));
streamDeck.actions.registerAction(new OpenThread(threadStore));
streamDeck.actions.registerAction(new PuckVariation());
streamDeck.actions.registerAction(new ShipThread(threadStore, bridge));
streamDeck.actions.registerAction(new ArchiveThread(threadStore));
streamDeck.actions.registerAction(new ReviewThread(threadStore));

streamDeck.connect();
