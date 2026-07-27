import streamDeck, {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getErrorMessage } from "../error-message";
import { renderPuckKeyImage } from "../rendering/puck-surface";

type ShowPuckSettings = {
	puckNumber?: number;
};

const puckCount = 138;
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
		const puckNumber = validPuckNumber(ev.payload.settings.puckNumber) ?? randomPuckNumber();
		this.currentNumbers.set(ev.action.id, puckNumber);
		await Promise.all([
			ev.action.setSettings({ puckNumber }),
			ev.action.setImage(puckImage(puckNumber)),
			ev.action.setTitle(""),
		]);
	}

	override onWillDisappear(ev: WillDisappearEvent<ShowPuckSettings>): void {
		this.generations.set(ev.action.id, (this.generations.get(ev.action.id) ?? 0) + 1);
		this.visibleActionIds.delete(ev.action.id);
		this.currentNumbers.delete(ev.action.id);
		this.pressedAt.delete(ev.action.id);
		this.clearTitleTimer(ev.action.id);
	}

	override onKeyDown(ev: KeyDownEvent<ShowPuckSettings>): void {
		if (ev.action.isKey() && this.visibleActionIds.has(ev.action.id))
			this.pressedAt.set(ev.action.id, performance.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ShowPuckSettings>): Promise<void> {
		if (!ev.action.isKey()) return;

		const generation = this.generations.get(ev.action.id);
		if (generation === undefined || !this.visibleActionIds.has(ev.action.id)) return;
		const currentNumber = this.currentNumbers.get(ev.action.id) ?? validPuckNumber(ev.payload.settings.puckNumber);
		const pressedAt = this.pressedAt.get(ev.action.id);
		this.pressedAt.delete(ev.action.id);
		const held = pressedAt !== undefined && performance.now() - pressedAt >= randomHoldMs;
		const puckNumber = held ? randomPuckNumber(currentNumber) : nextPuckNumber(currentNumber);
		this.currentNumbers.set(ev.action.id, puckNumber);
		this.clearTitleTimer(ev.action.id);
		await Promise.all([
			ev.action.setSettings({ puckNumber }),
			ev.action.setImage(puckImage(puckNumber)),
			ev.action.setTitle(`#${puckNumber.toString().padStart(2, "0")}\n${puckNames[puckNumber] ?? "PUCK"}`),
		]);
		if (!this.visibleActionIds.has(ev.action.id) || this.generations.get(ev.action.id) !== generation) return;
		const timer = setTimeout(() => {
			this.titleTimers.delete(ev.action.id);
			void ev.action.setTitle("").catch((error) => {
				streamDeck.logger.error(`Unable to clear Show Puck title: ${getErrorMessage(error)}`);
			});
		}, 1200);
		timer.unref();
		this.titleTimers.set(ev.action.id, timer);
	}

	private clearTitleTimer(actionId: string): void {
		const timer = this.titleTimers.get(actionId);
		if (timer) clearTimeout(timer);
		this.titleTimers.delete(actionId);
	}
}

function validPuckNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= puckCount ? value : undefined;
}

function puckImage(number: number): string {
	const fileName = `puck-${number.toString().padStart(3, "0")}.png`;
	const pngBase64 = readFileSync(join(process.cwd(), "imgs", "pucks", fileName)).toString("base64");
	return renderPuckKeyImage(pngBase64);
}

function randomPuckNumber(excluding?: number): number {
	if (excluding === undefined) return Math.floor(Math.random() * puckCount) + 1;
	const number = Math.floor(Math.random() * (puckCount - 1)) + 1;
	return number >= excluding ? number + 1 : number;
}

function nextPuckNumber(current: number | undefined): number {
	return current === undefined ? randomPuckNumber() : (current % puckCount) + 1;
}
