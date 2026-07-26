export const protocolVersion = 2;

export type CompanionThreadState = "idle" | "running" | "awaiting-approval" | "error" | "done" | "cancelled";

export type HelloMessage = {
	version: 2;
	type: "hello";
	clientId: string;
	clientNonce: string;
};

export type HelloAuthenticateMessage = {
	version: 2;
	type: "hello.authenticate";
	clientId: string;
	clientNonce: string;
	serverNonce: string;
	proof: string;
};

export type ThreadStatusMessage = {
	version: 2;
	type: "thread.status";
	threadID: string;
	state: CompanionThreadState;
	phase: string;
	executorKind?: "local" | "remote" | "unknown";
	unread?: boolean;
};

export type ThreadCommandName = "append" | "acknowledge";
export type ThreadCommandIntent = "shipping";

export type ThreadCommandMessage = {
	version: 2;
	type: "thread.command";
	commandID: string;
	threadID: string;
	command: ThreadCommandName;
	content?: string;
	intent?: ThreadCommandIntent;
};

export type ThreadCommandResultMessage = {
	version: 2;
	type: "thread.command.result";
	commandID: string;
	threadID: string;
	ok: boolean;
	error?: string;
};

export type CompanionMessage = HelloMessage | HelloAuthenticateMessage | ThreadStatusMessage | ThreadCommandResultMessage;

export type BridgeMessage =
	| { version: 2; type: "hello.challenge"; clientNonce: string; serverNonce: string; proof: string }
	| { version: 2; type: "hello.ack"; serverNonce: string; proof: string }
	| ThreadCommandMessage;
