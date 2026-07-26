import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import streamDeck from "@elgato/streamdeck";
import { WebSocket, WebSocketServer } from "ws";

import {
	protocolVersion,
	type BridgeMessage,
	type CompanionMessage,
	type ThreadCommandMessage,
	type ThreadCommandIntent,
	type ThreadCommandName,
	type ThreadCommandResultMessage,
	type ThreadStatusMessage,
} from "./protocol";

type BridgeListener = () => void;

type Client = {
	authenticated: boolean;
	receivedStatus: boolean;
	clientId?: string;
	clientNonce?: string;
	serverNonce?: string;
	statuses: Map<string, ThreadStatusMessage>;
};

type PendingCommand = {
	socket: WebSocket;
	threadId: string;
	intent?: ThreadCommandIntent;
	resolve: () => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

type ShippingState = {
	startedAt: number;
	seenWorking: boolean;
	timer: NodeJS.Timeout;
};

const host = "127.0.0.1";
const port = 17373;
const commandTimeoutMs = 10000;
const shippingStartTimeoutMs = 30000;
const maximumPayloadBytes = 16 * 1024;

export class BridgeServer {
	private readonly clients = new Map<WebSocket, Client>();
	private readonly listeners = new Set<BridgeListener>();
	private readonly pendingCommands = new Map<string, PendingCommand>();
	private readonly shippingThreads = new Map<string, ShippingState>();
	private readonly token = loadOrCreatePairingToken();
	private readonly server: WebSocketServer;

	constructor() {
		this.server = new WebSocketServer({ host, port, maxPayload: maximumPayloadBytes });
		this.server.on("connection", (socket) => this.handleConnection(socket));
		this.server.on("listening", () => streamDeck.logger.info(`Amp Deck bridge listening on ws://${host}:${port}`));
		this.server.on("error", (error) => streamDeck.logger.error(`Amp Deck bridge error: ${error.message}`));
	}

	getStatus(threadId: string): ThreadStatusMessage | undefined {
		const owners = this.getStatusOwners(threadId);
		return owners.length === 1 ? owners[0].client.statuses.get(threadId) : undefined;
	}

	isThreadConnected(threadId: string): boolean {
		return this.getCommandOwners(threadId).length === 1;
	}

	hasCompanion(): boolean {
		for (const client of this.clients.values()) {
			if (client.authenticated) return true;
		}
		return false;
	}

	observeShipping(threadId: string, working: boolean): boolean {
		const shipping = this.shippingThreads.get(threadId);
		if (!shipping) {
			return false;
		}

		if (working) {
			shipping.seenWorking = true;
			clearTimeout(shipping.timer);
			return true;
		}
		if (shipping.seenWorking || performance.now() - shipping.startedAt >= shippingStartTimeoutMs) {
			clearTimeout(shipping.timer);
			this.shippingThreads.delete(threadId);
			return false;
		}
		return true;
	}

	subscribe(listener: BridgeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	close(): Promise<void> {
		for (const commandID of [...this.pendingCommands.keys()]) {
			this.rejectPending(commandID, new Error("Amp Deck bridge is shutting down"));
		}
		for (const shipping of this.shippingThreads.values()) clearTimeout(shipping.timer);
		this.shippingThreads.clear();
		this.listeners.clear();
		for (const socket of this.clients.keys()) socket.terminate();
		this.clients.clear();

		return new Promise((resolve) => {
			this.server.close(() => resolve());
		});
	}

	sendCommand(
		threadId: string,
		command: ThreadCommandName,
		content?: string,
		intent?: ThreadCommandIntent,
	): Promise<void> {
		const owners = this.getCommandOwners(threadId);
		if (owners.length === 0) {
			return Promise.reject(new Error("Amp companion is not connected for this thread"));
		}
		if (owners.length > 1) {
			return Promise.reject(new Error("Multiple Amp companions advertise this thread"));
		}
		const [owner] = owners;

		const commandID = randomUUID();
		const message: ThreadCommandMessage = {
			version: protocolVersion,
			type: "thread.command",
			commandID,
			threadID: threadId,
			command,
			...(content ? { content } : {}),
			...(intent ? { intent } : {}),
		};

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingCommands.delete(commandID);
				reject(new Error("Amp companion did not acknowledge the command"));
			}, commandTimeoutMs);
			timer.unref();
			this.pendingCommands.set(commandID, { socket: owner.socket, threadId, intent, resolve, reject, timer });
			owner.socket.send(JSON.stringify(message), (error) => {
				if (error) {
					this.rejectPending(commandID, new Error("Unable to send command to Amp companion"));
				}
			});
		});
	}

	private handleConnection(socket: WebSocket): void {
		this.clients.set(socket, { authenticated: false, receivedStatus: false, statuses: new Map() });
		const authenticationTimer = setTimeout(() => socket.close(4001, "Authentication required"), 5000);
		authenticationTimer.unref();

		socket.on("message", (data) => {
			const message = parseMessage(
				Array.isArray(data)
					? Buffer.concat(data).toString()
					: data instanceof ArrayBuffer
						? Buffer.from(new Uint8Array(data)).toString()
						: data.toString(),
			);
			const client = this.clients.get(socket);
			if (!message || !client) {
				socket.close(4002, "Invalid protocol message");
				return;
			}

			if (!client.authenticated) {
				this.handleAuthentication(socket, client, message, authenticationTimer);
				return;
			}

			if (message.type === "thread.status") {
				client.statuses.set(message.threadID, message);
				if (!client.receivedStatus) {
					client.receivedStatus = true;
					streamDeck.logger.info("Authenticated Amp companion published semantic status");
				}
				this.notify();
			} else if (message.type === "thread.command.result") {
				this.resolveCommand(socket, message);
			} else {
				socket.close(4002, "Unexpected protocol message");
			}
		});
		socket.on("close", () => {
			clearTimeout(authenticationTimer);
			this.clients.delete(socket);
			for (const [commandID, pending] of this.pendingCommands) {
				if (pending.socket === socket) {
					this.rejectPending(commandID, new Error("Amp companion disconnected; command outcome is unknown"));
				}
			}
			this.notify();
		});
		socket.on("error", (error) => streamDeck.logger.warn(`Amp companion socket error: ${error.message}`));
	}

	private handleAuthentication(
		socket: WebSocket,
		client: Client,
		message: CompanionMessage,
		authenticationTimer: NodeJS.Timeout,
	): void {
		if (message.type === "hello") {
			const serverNonce = randomBytes(32).toString("hex");
			client.clientId = message.clientId;
			client.clientNonce = message.clientNonce;
			client.serverNonce = serverNonce;
			this.send(socket, {
				version: protocolVersion,
				type: "hello.challenge",
				clientNonce: message.clientNonce,
				serverNonce,
				proof: proof(this.token, "server", message.clientId, message.clientNonce, serverNonce),
			});
			return;
		}

		if (
			message.type !== "hello.authenticate" ||
			message.clientId !== client.clientId ||
			message.clientNonce !== client.clientNonce ||
			message.serverNonce !== client.serverNonce ||
			!proofMatches(
				message.proof,
				proof(this.token, "client", message.clientId, message.clientNonce, message.serverNonce),
			)
		) {
			socket.close(4003, "Authentication failed");
			return;
		}

		for (const [otherSocket, otherClient] of this.clients) {
			if (otherSocket !== socket && otherClient.authenticated && otherClient.clientId === message.clientId) {
				otherSocket.close(4000, "Client reconnected");
			}
		}
		client.authenticated = true;
		clearTimeout(authenticationTimer);
		streamDeck.logger.info("Amp companion authenticated");
		this.send(socket, {
			version: protocolVersion,
			type: "hello.ack",
			serverNonce: message.serverNonce,
			proof: proof(this.token, "ack", message.clientId, message.clientNonce, message.serverNonce),
		});
		this.notify();
	}

	private resolveCommand(socket: WebSocket, message: ThreadCommandResultMessage): void {
		const pending = this.pendingCommands.get(message.commandID);
		if (!pending || pending.socket !== socket || pending.threadId !== message.threadID) {
			return;
		}

		clearTimeout(pending.timer);
		this.pendingCommands.delete(message.commandID);
		if (message.ok) {
			if (pending.intent === "shipping") {
				const existing = this.shippingThreads.get(message.threadID);
				if (existing) clearTimeout(existing.timer);
				const shipping: ShippingState = {
					startedAt: performance.now(),
					seenWorking: false,
					timer: setTimeout(() => {
						if (this.shippingThreads.get(message.threadID) !== shipping || shipping.seenWorking) return;
						this.shippingThreads.delete(message.threadID);
						this.notify();
					}, shippingStartTimeoutMs),
				};
				shipping.timer.unref();
				this.shippingThreads.set(message.threadID, shipping);
				this.notify();
			}
			streamDeck.logger.info("Amp companion acknowledged command");
			pending.resolve();
		} else {
			streamDeck.logger.warn("Amp companion rejected command");
			pending.reject(new Error("Amp companion rejected the command"));
		}
	}

	private rejectPending(commandID: string, error: Error): void {
		const pending = this.pendingCommands.get(commandID);
		if (!pending) {
			return;
		}

		clearTimeout(pending.timer);
		this.pendingCommands.delete(commandID);
		pending.reject(error);
	}

	private getStatusOwners(threadId: string): Array<{ socket: WebSocket; client: Client }> {
		const owners: Array<{ socket: WebSocket; client: Client }> = [];
		for (const [socket, client] of this.clients) {
			if (client.authenticated && socket.readyState === WebSocket.OPEN && client.statuses.has(threadId)) {
				owners.push({ socket, client });
			}
		}
		return owners;
	}

	private getCommandOwners(threadId: string): Array<{ socket: WebSocket; client: Client }> {
		return this.getStatusOwners(threadId);
	}

	private send(socket: WebSocket, message: BridgeMessage): void {
		socket.send(JSON.stringify(message));
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

function parseMessage(value: string): CompanionMessage | undefined {
	try {
		const message: unknown = JSON.parse(value);
		if (!isRecord(message) || message.version !== protocolVersion || typeof message.type !== "string") return undefined;

		if (message.type === "hello") {
			return isBoundedString(message.clientId, 128) && isHex(message.clientNonce, 64)
				? (message as CompanionMessage)
				: undefined;
		}
		if (message.type === "hello.authenticate") {
			return isBoundedString(message.clientId, 128) &&
				isHex(message.clientNonce, 64) &&
				isHex(message.serverNonce, 64) &&
				isHex(message.proof, 64)
				? (message as CompanionMessage)
				: undefined;
		}
		if (message.type === "thread.status") {
			const states = new Set(["idle", "running", "awaiting-approval", "error", "done", "cancelled"]);
			const executorKinds = new Set(["local", "remote", "unknown"]);
			return isThreadId(message.threadID) &&
				states.has(message.state as string) &&
				isBoundedString(message.phase, 64) &&
				(message.executorKind === undefined || executorKinds.has(message.executorKind as string)) &&
				(message.unread === undefined || typeof message.unread === "boolean")
				? (message as CompanionMessage)
				: undefined;
		}
		if (message.type === "thread.command.result") {
			return isBoundedString(message.commandID, 64) &&
				isThreadId(message.threadID) &&
				typeof message.ok === "boolean" &&
				(message.error === undefined || isBoundedString(message.error, 64))
				? (message as CompanionMessage)
				: undefined;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function proof(token: string, role: string, clientId: string, clientNonce: string, serverNonce: string): string {
	return createHmac("sha256", token).update(`${role}|${clientId}|${clientNonce}|${serverNonce}`).digest("hex");
}

function proofMatches(actual: string, expected: string): boolean {
	const actualBytes = Buffer.from(actual, "hex");
	const expectedBytes = Buffer.from(expected, "hex");
	return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function isThreadId(value: unknown): value is string {
	return typeof value === "string" && /^T-[a-zA-Z0-9-]{8,}$/.test(value) && value.length <= 80;
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= maximumLength;
}

function isHex(value: unknown, length: number): value is string {
	return typeof value === "string" && value.length === length && /^[a-f0-9]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function loadOrCreatePairingToken(): string {
	const directory = join(homedir(), ".config", "amp-deck");
	const path = join(directory, "bridge.json");
	mkdirSync(directory, { recursive: true });

	let token: string | undefined;
	try {
		const config: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (isRecord(config) && isHex(config.token, 64)) {
			token = config.token;
		}
	} catch {
		// Create a fresh local pairing file below.
	}

	token ??= randomBytes(32).toString("hex");
	writeFileSync(path, JSON.stringify({ version: protocolVersion, host, port, token }, null, 2), { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// Windows ACLs are inherited from the user's profile directory.
	}
	return token;
}
