import streamDeck, {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

type ShowPuckSettings = {
	puckNumber?: number;
	/** Migrated from the original eight-variation implementation. */
	puckIndex?: number;
};

const puckCount = 138;
const legacyPuckNumbers = [118, 120, 123, 124, 132, 133, 137, 138] as const;
const puckNames: Partial<Record<number, string>> = {
	118: "LAVA LAMP",
	119: "BUBBLE WRAP",
	120: "CORAL",
	121: "WET CLAY",
	122: "CAST IRON",
	123: "BISMUTH",
	124: "KINTSUGI",
	125: "FERROFLUID",
	126: "PATCHWORK",
	127: "HOCKEY PUCK",
	128: "ESPRESSO",
	129: "DIET COLA",
	130: "MATCHA LATTE",
	131: "RACCOON FUR",
	132: "ELECTRONICS",
	133: "ALIEN",
	134: "AEROGEL",
	135: "METEORITE",
	136: "MYCELIUM",
	137: "DICHROIC",
	138: "BIOLUMINESCENT",
};

const randomHoldMs = 750;

@action({ UUID: "com.daniel-insley.amp-deck.puck-variation" })
export class ShowPuck extends SingletonAction<ShowPuckSettings> {
	private readonly currentNumbers = new Map<string, number>();
	private readonly generations = new Map<string, number>();
	private readonly pressedAt = new Map<string, number>();
	private readonly titleTimers = new Map<string, NodeJS.Timeout>();
	private readonly visibleActionIds = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent<ShowPuckSettings>): Promise<void> {
		if (!ev.action.isKey()) return;

		const generation = (this.generations.get(ev.action.id) ?? 0) + 1;
		this.generations.set(ev.action.id, generation);
		this.visibleActionIds.add(ev.action.id);
		const puckNumber = resolvePuckNumber(ev.payload.settings) ?? randomPuckNumber();
		this.currentNumbers.set(ev.action.id, puckNumber);
		await Promise.all([ev.action.setSettings({ puckNumber }), ev.action.setImage(puckImage(puckNumber))]);
	}

	override onWillDisappear(ev: WillDisappearEvent<ShowPuckSettings>): void {
		this.generations.set(ev.action.id, (this.generations.get(ev.action.id) ?? 0) + 1);
		this.visibleActionIds.delete(ev.action.id);
		this.currentNumbers.delete(ev.action.id);
		this.pressedAt.delete(ev.action.id);
		const timer = this.titleTimers.get(ev.action.id);
		if (timer) clearTimeout(timer);
		this.titleTimers.delete(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<ShowPuckSettings>): void {
		if (ev.action.isKey() && this.visibleActionIds.has(ev.action.id))
			this.pressedAt.set(ev.action.id, performance.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ShowPuckSettings>): Promise<void> {
		if (!ev.action.isKey()) return;

		const generation = this.generations.get(ev.action.id);
		if (generation === undefined || !this.visibleActionIds.has(ev.action.id)) return;
		const currentNumber = this.currentNumbers.get(ev.action.id) ?? resolvePuckNumber(ev.payload.settings);
		const pressedAt = this.pressedAt.get(ev.action.id);
		this.pressedAt.delete(ev.action.id);
		const held = pressedAt !== undefined && performance.now() - pressedAt >= randomHoldMs;
		const puckNumber = held ? randomPuckNumber(currentNumber) : nextPuckNumber(currentNumber);
		this.currentNumbers.set(ev.action.id, puckNumber);
		await Promise.all([
			ev.action.setSettings({ puckNumber }),
			ev.action.setImage(puckImage(puckNumber)),
			ev.action.setTitle(`#${puckNumber.toString().padStart(2, "0")}\n${puckNames[puckNumber] ?? "PUCK"}`),
		]);
		if (!this.visibleActionIds.has(ev.action.id) || this.generations.get(ev.action.id) !== generation) return;
		const previousTimer = this.titleTimers.get(ev.action.id);
		if (previousTimer) clearTimeout(previousTimer);
		const timer = setTimeout(() => {
			this.titleTimers.delete(ev.action.id);
			void ev.action.setTitle("").catch((error) => {
				streamDeck.logger.error(`Unable to clear Show Puck title: ${getErrorMessage(error)}`);
			});
		}, 1200);
		timer.unref();
		this.titleTimers.set(ev.action.id, timer);
	}
}

function resolvePuckNumber(settings: ShowPuckSettings): number | undefined {
	if (isPuckNumber(settings.puckNumber)) return settings.puckNumber;
	if (isLegacyPuckIndex(settings.puckIndex)) return legacyPuckNumbers[settings.puckIndex];
	return undefined;
}

function isPuckNumber(value: number | undefined): value is number {
	return Number.isInteger(value) && value !== undefined && value >= 1 && value <= puckCount;
}

function isLegacyPuckIndex(value: number | undefined): value is number {
	return Number.isInteger(value) && value !== undefined && value >= 0 && value < legacyPuckNumbers.length;
}

function puckImage(number: number): string {
	return `imgs/pucks/puck-${number.toString().padStart(3, "0")}.png`;
}

function randomPuckNumber(excluding?: number): number {
	if (excluding === undefined) return Math.floor(Math.random() * puckCount) + 1;
	const number = Math.floor(Math.random() * (puckCount - 1)) + 1;
	return number >= excluding ? number + 1 : number;
}

function nextPuckNumber(current: number | undefined): number {
	return current === undefined ? randomPuckNumber() : (current % puckCount) + 1;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
