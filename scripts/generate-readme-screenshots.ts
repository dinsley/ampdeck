import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { AmpTopThread } from "../src/amp/amp-top-model";
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
const commandKeyTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "command-key.svg"), "utf8");
const commandFeedbackTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "command-feedback.svg"), "utf8");
const openThreadKeyTemplate = readFileSync(resolve(repositoryRoot, "src", "assets", "open-thread-key.svg"), "utf8");
const fixedNow = Date.UTC(2026, 6, 26, 22, 0, 0);

mkdirSync(outputDirectory, { recursive: true });

const threadStates = [
	threadState({
		project: "STOREFRONT",
		title: "Add saved payment methods",
		status: "IDLE",
		visualStatus: "idle",
		executorConnected: true,
		working: false,
		position: "3/8",
		updatedSecondsAgo: 18,
		phaseSecondsAgo: 142,
		usageCost: "$1.84",
	}),
	threadState({
		project: "DESIGN SYSTEM",
		title: "Repair keyboard navigation",
		status: "WORKING",
		visualStatus: "running",
		executorConnected: true,
		working: true,
		position: "1/8",
		updatedSecondsAgo: 3,
		phaseSecondsAgo: 47,
		usageCost: "$0.92",
	}),
	threadState({
		project: "DESKTOP APP",
		title: "Prepare the release candidate",
		status: "SHIPPING",
		visualStatus: "shipping",
		executorConnected: true,
		working: true,
		phase: "shipping",
		position: "1/8",
		updatedSecondsAgo: 8,
		phaseSecondsAgo: 76,
		usageCost: "$3.16",
	}),
	threadState({
		project: "API",
		title: "Trace intermittent timeouts",
		status: "DONE",
		visualStatus: "done",
		executorConnected: false,
		working: false,
		position: "6/8",
		updatedSecondsAgo: 540,
		phaseSecondsAgo: 540,
		usageCost: "$2.05",
	}),
] as const;

writeScreenshot("recommended-layout", 1600, 720, renderRecommendedLayout());
writeScreenshot("thread-states", 1600, 520, renderThreadStates());
writeScreenshot("action-feedback", 1600, 760, renderActionFeedback());
writeScreenshot("puck-gallery", 1600, 420, renderPuckGallery());

function renderRecommendedLayout(): string {
	const surface = threadStates[0].surface;
	const keys = [
		renderOpenThreadKeySvg({ title: "Add saved payment methods", dimmed: false }),
		renderCommandKeySvg({
			label: "REVIEW",
			detail: "Add saved payment methods",
			icon: "review",
		}),
		renderCommandKeySvg({
			label: "SHIP",
			detail: "Add saved payment methods",
			icon: "ship",
		}),
		renderCommandKeySvg({
			label: "ARCHIVE",
			detail: "Add saved payment methods",
			icon: "archive",
		}),
	];

	return canvas(
		1600,
		720,
		`
		<rect x="155" y="42" width="1290" height="590" rx="50" fill="#202228" stroke="#343740" stroke-width="3"/>
		<rect x="197" y="82" width="1206" height="280" rx="30" fill="#17191D"/>
		${keys
			.map(
				(key, index) => `
				${embeddedSvg(key, 286 + index * 255, 112, 188, 188)}`,
			)
			.join("")}
		<rect x="197" y="396" width="1206" height="151" rx="24" fill="#101114"/>
		${embeddedSvg(surface, 240, 402, 1120, 140)}
		<g fill="#5B5F69">
			${[0, 1, 2, 3].map((index) => `<circle cx="${380 + index * 280}" cy="592" r="26"/>`).join("")}
		</g>`,
	);
}

function renderThreadStates(): string {
	const coordinates = [
		[80, 75],
		[820, 75],
		[80, 295],
		[820, 295],
	] as const;

	return canvas(
		1600,
		520,
		`
		${threadStates
			.map((state, index) => {
				const [x, y] = coordinates[index];
				return `
				<rect x="${x}" y="${y}" width="700" height="150" rx="28" fill="#202228" stroke="#343740" stroke-width="2"/>
				<rect x="${x + 24}" y="${y + 16}" width="652" height="118" rx="16" fill="#101114"/>
				${embeddedSvg(state.surface, x + 30, y + 25, 640, 80)}`;
			})
			.join("")}`,
	);
}

function renderActionFeedback(): string {
	const examples = [
		renderCommandKeySvg({
			label: "REVIEW",
			detail: "Add saved payment methods",
			icon: "review",
		}),
		renderCommandKeySvg({
			label: "SHIP",
			detail: "Add saved payment methods",
			icon: "ship",
			progress: 0.62,
		}),
		renderCommandKeySvg({
			label: "ARCHIVE",
			detail: "Add saved payment methods",
			icon: "archive",
			dimmed: true,
			footer: "BUSY",
			loading: true,
		}),
		renderCommandFeedbackSvg("sent"),
		renderCommandFeedbackSvg("unavailable"),
		renderCommandFeedbackSvg("error"),
	];

	return canvas(
		1600,
		760,
		`
		${examples
			.map((example, index) => {
				const x = 120 + (index % 3) * 500;
				const y = 70 + Math.floor(index / 3) * 340;
				return `
				<rect x="${x}" y="${y}" width="360" height="280" rx="32" fill="#202228" stroke="#343740" stroke-width="2"/>
				<rect x="${x + 58}" y="${y + 18}" width="244" height="244" rx="28" fill="#101114"/>
				${embeddedSvg(example, x + 68, y + 28, 224, 224)}`;
			})
			.join("")}`,
	);
}

function renderPuckGallery(): string {
	const pucks = [118, 123, 132, 137] as const;

	return canvas(
		1600,
		420,
		`
		${pucks
			.map((puck, index) => {
				const x = 80 + (index % 4) * 380;
				const y = 55;
				return `
				<rect x="${x}" y="${y}" width="330" height="310" rx="32" fill="#202228" stroke="#343740" stroke-width="2"/>
				<rect x="${x + 20}" y="${y + 10}" width="290" height="290" rx="28" fill="#111217"/>
				${embeddedPng(puck, x + 20, y + 10, 290, 290)}`;
			})
			.join("")}`,
	);
}

function threadState(options: {
	project: string;
	title: string;
	status: DisplayModel["status"];
	visualStatus: DisplayModel["visualStatus"];
	executorConnected: boolean;
	working: boolean;
	phase?: string;
	position: string;
	updatedSecondsAgo: number;
	phaseSecondsAgo: number;
	usageCost: string;
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
		phase: options.phase,
		usageCost: options.usageCost,
	};
	const model: DisplayModel = { status: options.status, visualStatus: options.visualStatus };
	const phase: PhaseMetadata = {
		current: options.status,
		startedAt: fixedNow - options.phaseSecondsAgo * 1000,
	};
	return {
		model,
		surface: renderEncoderFocusSurfaceSvg(encoderTemplate, {
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
		<rect width="${width}" height="${height}" fill="#121317"/>
		<circle cx="1460" cy="60" r="220" fill="#F0A832" opacity=".055"/>
		${content}
	</svg>`;
}

function embeddedSvg(svg: string, x: number, y: number, width: number, height: number): string {
	return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/>`;
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

function writeScreenshot(name: string, width: number, height: number, svg: string): void {
	const svgPath = resolve(outputDirectory, `${name}.svg`);
	const pngPath = resolve(outputDirectory, `${name}.png`);
	writeFileSync(svgPath, `${svg.replaceAll(/[ \t]+$/gm, "").trim()}\n`);
	const browser = findBrowser();
	execFileSync(
		browser,
		[
			"--headless",
			"--disable-gpu",
			"--hide-scrollbars",
			"--force-device-scale-factor=1",
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
