import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AmpTopThread, ExecutionOrigin } from "../src/amp/amp-top-model";
import type { DisplayModel, PhaseMetadata } from "../src/model/thread-status";
import { busyIndicatorFrameDurationMs } from "../src/rendering/busy-indicator";
import {
	renderCommandFeedbackSvg as renderCommandFeedbackTemplateSvg,
	renderCommandKeySvg as renderCommandKeyTemplateSvg,
	renderOpenThreadKeySvg as renderOpenThreadKeyTemplateSvg,
	type CommandFeedbackKind,
	type CommandKeyOptions,
} from "../src/rendering/command-surface";
import { renderEncoderFocusSurfaceSvg } from "../src/rendering/encoder-surface";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(repositoryRoot, "docs", "images");
const encoderTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "encoder-focus.svg"), "utf8");
const orbIconTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "orb.svg"), "utf8");
const commandKeyTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "command-key.svg"), "utf8");
const commandFeedbackTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "command-feedback.svg"), "utf8");
const openThreadKeyTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "open-thread-key.svg"), "utf8");
const streamDeckPlusFrame = readFileSync(resolve(repositoryRoot, "docs", "assets", "stream-deck-plus-frame.webp"));
const fixedNow = Date.UTC(2026, 6, 26, 22, 0, 0);
type RecommendedLayoutState = "ready" | "holding" | "sent" | "working" | "shipping" | "done";

mkdirSync(outputDirectory, { recursive: true });

const threadStates = [
	threadState({
		project: "STOREFRONT",
		title: "Add saved payment methods",
		status: "IDLE",
		visualStatus: "idle",
		executorConnected: true,
		executionOrigin: "cli",
		working: false,
		position: "3/8",
		updatedSecondsAgo: 18,
		phaseSecondsAgo: 142,
		usageCost: "$1.84",
		tokensUsed: 128_400,
	}),
	threadState({
		project: "DESIGN SYSTEM",
		title: "Repair keyboard navigation",
		status: "WORKING",
		visualStatus: "running",
		executorConnected: true,
		executionOrigin: "orb",
		working: true,
		position: "1/8",
		updatedSecondsAgo: 3,
		phaseSecondsAgo: 47,
		usageCost: "$0.92",
		tokensUsed: 87_250,
	}),
	threadState({
		project: "DESKTOP APP",
		title: "Prepare the release candidate",
		status: "SHIPPING",
		visualStatus: "shipping",
		executorConnected: true,
		executionOrigin: "cli",
		working: true,
		phase: "shipping",
		position: "1/8",
		updatedSecondsAgo: 8,
		phaseSecondsAgo: 76,
		usageCost: "$3.16",
		tokensUsed: 1_248_600,
	}),
	threadState({
		project: "API",
		title: "Trace intermittent timeouts",
		status: "DONE",
		visualStatus: "done",
		executorConnected: false,
		executionOrigin: "orb",
		working: false,
		position: "6/8",
		updatedSecondsAgo: 540,
		phaseSecondsAgo: 540,
		usageCost: "$2.05",
		tokensUsed: 245_600,
	}),
] as const;

writeAnimation("recommended-layout", 1400, 1356, [
	["ready", 140],
	["holding", 80],
	["sent", 110],
	["working", 130],
	["shipping", 130],
	["done", 150],
]);

function renderRecommendedLayout(state: RecommendedLayoutState = "ready"): string {
	const stateIndex = { ready: 0, holding: 0, sent: 0, working: 1, shipping: 2, done: 3 }[state];
	const surface = threadStates[stateIndex].surface;
	const commandKeys = renderRecommendedCommandKeys(state);
	const keyX = [168, 461, 754, 1048] as const;
	const pucks = [118, 123, 132, 137] as const;

	return canvas(
		1400,
		1356,
		`
		${embeddedRaster(streamDeckPlusFrame, "image/webp", 0, 0, 1400, 1356)}
		${keyX
			.map(
				(x) =>
					`<rect x="${x - 9}" y="121" width="202" height="202" rx="29" fill="#0D0E12" stroke="#08090C" stroke-width="7"/>`,
			)
			.join("")}
		${pucks
			.map(
				(puck, index) => `
				<clipPath id="puck-key-${index}">
					<rect x="${keyX[index] + 4}" y="136" width="176" height="176" rx="14"/>
				</clipPath>
				<g clip-path="url(#puck-key-${index})">
					${embeddedPng(puck, keyX[index] + 4, 136, 176, 176)}
				</g>`,
			)
			.join("")}
		${commandKeys.map((key, index) => embeddedSvg(key, keyX[index], 346, 184, 184)).join("")}
		${embeddedSvg(surface, 160, 639, 1080, 135)}`,
	);
}

function renderRecommendedCommandKeys(state: RecommendedLayoutState): string[] {
	const title = {
		ready: "Add saved payment methods",
		holding: "Add saved payment methods",
		sent: "Add saved payment methods",
		working: "Repair keyboard navigation",
		shipping: "Prepare the release candidate",
		done: "Trace intermittent timeouts",
	}[state];
	const commandKey = (
		label: CommandKeyOptions["label"],
		icon: CommandKeyOptions["icon"],
		options: Partial<CommandKeyOptions> = {},
	): string => renderCommandKeySvg({ label, detail: title, icon, ...options });
	const open = renderOpenThreadKeySvg({ title, dimmed: false });

	switch (state) {
		case "holding":
			return [
				open,
				commandKey("ARCHIVE", "archive"),
				commandKey("REVIEW", "review", { progress: 0.68 }),
				commandKey("SHIP", "ship"),
			];
		case "sent":
			return [open, commandKey("ARCHIVE", "archive"), renderCommandFeedbackSvg("sent"), commandKey("SHIP", "ship")];
		case "working":
			return [
				open,
				commandKey("ARCHIVE", "archive", { dimmed: true, footer: "WORKING" }),
				commandKey("REVIEW", "review", { dimmed: true, footer: "WORKING" }),
				commandKey("SHIP", "ship", { dimmed: true, footer: "WORKING" }),
			];
		case "shipping":
			return [
				open,
				commandKey("ARCHIVE", "archive", { dimmed: true, footer: "SHIPPING" }),
				commandKey("REVIEW", "review", { dimmed: true, footer: "SHIPPING" }),
				commandKey("SHIP", "ship", { dimmed: true, footer: "BUSY", loading: true }),
			];
		case "done":
			return [
				open,
				commandKey("ARCHIVE", "archive"),
				commandKey("REVIEW", "review", { dimmed: true, footer: "NO EXECUTOR" }),
				commandKey("SHIP", "ship", { dimmed: true, footer: "NO EXECUTOR" }),
			];
		default:
			return [open, commandKey("ARCHIVE", "archive"), commandKey("REVIEW", "review"), commandKey("SHIP", "ship")];
	}
}

function threadState(options: {
	project: string;
	title: string;
	status: DisplayModel["status"];
	visualStatus: DisplayModel["visualStatus"];
	executorConnected: boolean;
	executionOrigin: ExecutionOrigin;
	working: boolean;
	phase?: string;
	position: string;
	updatedSecondsAgo: number;
	phaseSecondsAgo: number;
	usageCost: string;
	tokensUsed: number;
}): {
	model: DisplayModel;
	surface: string;
} {
	const thread: AmpTopThread = {
		id: options.title.toLowerCase().replaceAll(" ", "-"),
		title: options.title,
		project: options.project,
		updatedAt: new Date(fixedNow - options.updatedSecondsAgo * 1000).toISOString(),
		working: options.working,
		executorConnected: options.executorConnected,
		executionOrigin: options.executionOrigin,
		phase: options.phase,
		usageCost: options.usageCost,
		tokensUsed: options.tokensUsed,
	};
	const model: DisplayModel = { status: options.status, visualStatus: options.visualStatus };
	const phase: PhaseMetadata = {
		current: options.status,
		startedAt: fixedNow - options.phaseSecondsAgo * 1000,
	};
	return {
		model,
		surface: renderEncoderFocusSurfaceSvg(encoderTemplate, orbIconTemplate, {
			thread,
			model,
			animationFrame: 3,
			position: options.position,
			phase,
			now: fixedNow,
		}),
	};
}

function renderCommandKeySvg(options: CommandKeyOptions): string {
	const previewNow = options.loading ? busyIndicatorFrameDurationMs * 8 : fixedNow;
	return renderCommandKeyTemplateSvg(commandKeyTemplate, options, previewNow);
}

function renderOpenThreadKeySvg(options: { title: string; dimmed: boolean }): string {
	return renderOpenThreadKeyTemplateSvg(openThreadKeyTemplate, options);
}

function renderCommandFeedbackSvg(kind: CommandFeedbackKind): string {
	return renderCommandFeedbackTemplateSvg(commandFeedbackTemplate, kind);
}

function canvas(width: number, height: number, content: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
		${content}
	</svg>`;
}

function embeddedSvg(svg: string, x: number, y: number, width: number, height: number): string {
	return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/>`;
}

function embeddedRaster(image: Buffer, mimeType: string, x: number, y: number, width: number, height: number): string {
	return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:${mimeType};base64,${image.toString("base64")}"/>`;
}

function embeddedPng(number: number, x: number, y: number, width: number, height: number): string {
	const path = resolve(
		repositoryRoot,
		"com.dinsley.ampdeck.sdPlugin",
		"imgs",
		"pucks",
		`puck-${number.toString().padStart(3, "0")}.png`,
	);
	return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/png;base64,${readFileSync(path).toString("base64")}"/>`;
}

function writeAnimation(
	name: string,
	width: number,
	height: number,
	frames: ReadonlyArray<readonly [RecommendedLayoutState, number]>,
): void {
	const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "ampdeck-readme-"));
	try {
		const framePaths = frames.map(([state], index) => {
			const svgPath = resolve(temporaryDirectory, `${index}.svg`);
			const pngPath = resolve(temporaryDirectory, `${index}.png`);
			writeFileSync(
				svgPath,
				`${renderRecommendedLayout(state)
					.replaceAll(/[ \t]+$/gm, "")
					.trim()}\n`,
			);
			rasterizeSvg(svgPath, pngPath, width, height);
			return pngPath;
		});
		const animationArguments = frames.flatMap(([, delay], index) => ["-delay", delay.toString(), framePaths[index]]);
		execFileSync(
			"magick",
			[
				...animationArguments,
				"-loop",
				"0",
				"-resize",
				"900x",
				"-quality",
				"84",
				"-define",
				"webp:method=6",
				resolve(outputDirectory, `${name}-animated.webp`),
			],
			{ stdio: "ignore" },
		);
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function rasterizeSvg(svgPath: string, pngPath: string, width: number, height: number): void {
	const browser = findBrowser();
	execFileSync(
		browser,
		[
			"--headless",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
			"--default-background-color=00000000",
			`--window-size=${width},${height}`,
			`--screenshot=${pngPath}`,
			pathToFileURL(svgPath).href,
		],
		{ stdio: "ignore" },
	);
}

function findBrowser(): string {
	const candidates =
		process.platform === "win32"
			? [
					resolve(process.env["ProgramFiles(x86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
					resolve(process.env.ProgramFiles ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
					resolve(process.env.ProgramFiles ?? "", "Google", "Chrome", "Application", "chrome.exe"),
				]
			: process.platform === "darwin"
				? [
						"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
						"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					]
				: ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium"];
	const browser = candidates.find((candidate) => existsSync(candidate));
	if (!browser) throw new Error("Microsoft Edge, Google Chrome, or Chromium is required to rasterize screenshots.");
	return browser;
}
