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
		position: "3 OF 8",
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
		position: "1 OF 8",
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
		position: "1 OF 8",
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
		position: "6 OF 8",
		updatedSecondsAgo: 540,
		phaseSecondsAgo: 540,
		usageCost: "$2.05",
	}),
] as const;

writeScreenshot("recommended-layout", 1600, 900, renderRecommendedLayout());
writeScreenshot("thread-states", 1600, 900, renderThreadStates());
writeScreenshot("action-feedback", 1600, 900, renderActionFeedback());
writeScreenshot("puck-gallery", 1600, 650, renderPuckGallery());

function renderRecommendedLayout(): string {
	const surface = threadStates[0].surface;
	const keys = [
		{
			label: "Open in browser",
			svg: renderOpenThreadKeySvg({ title: "Add saved payment methods", dimmed: false }),
		},
		{
			label: "Review changes",
			svg: renderCommandKeySvg({
				label: "REVIEW",
				detail: "Add saved payment methods",
				color: "#F34E3F",
				icon: "review",
			}),
		},
		{
			label: "Run shipping workflow",
			svg: renderCommandKeySvg({
				label: "SHIP",
				detail: "Add saved payment methods",
				color: "#F34E3F",
				icon: "ship",
			}),
		},
		{
			label: "Archive thread",
			svg: renderCommandKeySvg({
				label: "ARCHIVE",
				detail: "Add saved payment methods",
				color: "#D6A038",
				icon: "archive",
			}),
		},
	];

	return canvas(
		1600,
		900,
		`
		<text x="120" y="108" class="eyebrow">RECOMMENDED STREAM DECK+ PAGE</text>
		<text x="120" y="164" class="heading">One selected thread. Four deliberate actions.</text>
		<text x="120" y="207" class="body">Rotate any encoder to choose a thread; every key follows that shared selection.</text>
		<rect x="155" y="258" width="1290" height="512" rx="50" fill="#202228" stroke="#343740" stroke-width="3"/>
		<rect x="197" y="298" width="1206" height="260" rx="30" fill="#17191D"/>
		${keys
			.map(
				(key, index) => `
				${embeddedSvg(key.svg, 294 + index * 255, 330, 170, 170)}
				<text x="${379 + index * 255}" y="535" class="caption" text-anchor="middle">${key.label}</text>`,
			)
			.join("")}
		<rect x="197" y="586" width="1206" height="151" rx="24" fill="#101114"/>
		${embeddedSvg(surface, 240, 609, 1120, 140)}
		<g fill="#5B5F69">
			${[0, 1, 2, 3].map((index) => `<circle cx="${380 + index * 280}" cy="802" r="26"/>`).join("")}
		</g>
		<text x="800" y="857" class="caption" text-anchor="middle">Thread Status spans all four encoder slots</text>`,
	);
}

function renderThreadStates(): string {
	const descriptions = [
		"Executor connected and ready",
		"Amp is planning or using tools",
		"Shipping workflow is active",
		"Turn complete; no executor connected",
	];
	const coordinates = [
		[80, 212],
		[820, 212],
		[80, 530],
		[820, 530],
	] as const;

	return canvas(
		1600,
		900,
		`
		<text x="80" y="90" class="eyebrow">THREAD STATUS</text>
		<text x="80" y="146" class="heading">Know what needs attention at a glance.</text>
		${threadStates
			.map((state, index) => {
				const [x, y] = coordinates[index];
				return `
				<rect x="${x}" y="${y}" width="700" height="252" rx="28" fill="#202228" stroke="#343740" stroke-width="2"/>
				<text x="${x + 28}" y="${y + 46}" class="card-title">${state.model.status}</text>
				<text x="${x + 672}" y="${y + 45}" class="caption" text-anchor="end">${descriptions[index]}</text>
				<rect x="${x + 24}" y="${y + 72}" width="652" height="118" rx="16" fill="#101114"/>
				${embeddedSvg(state.surface, x + 30, y + 81, 640, 80)}
				<text x="${x + 28}" y="${y + 224}" class="small">${state.note}</text>`;
			})
			.join("")}`,
	);
}

function renderActionFeedback(): string {
	const examples = [
		{
			title: "READY",
			note: ["Press Open, or hold", "a command"],
			svg: renderCommandKeySvg({
				label: "REVIEW",
				detail: "Add saved payment methods",
				color: "#F34E3F",
				icon: "review",
			}),
		},
		{
			title: "HOLDING",
			note: ["Release early to cancel"],
			svg: renderCommandKeySvg({
				label: "SHIP",
				detail: "Add saved payment methods",
				color: "#F34E3F",
				icon: "ship",
				progress: 0.62,
			}),
		},
		{
			title: "BUSY",
			note: ["Command is being", "accepted"],
			svg: renderCommandKeySvg({
				label: "ARCHIVE",
				detail: "Add saved payment methods",
				color: "#D6A038",
				icon: "archive",
				dimmed: true,
				footer: "BUSY",
				loading: true,
			}),
		},
		{ title: "SENT", note: ["Review or Ship", "was accepted"], svg: renderCommandFeedbackSvg("sent") },
		{
			title: "UNAVAILABLE",
			note: ["The action is", "temporarily blocked"],
			svg: renderCommandFeedbackSvg("unavailable"),
		},
		{ title: "ERROR", note: ["Check the thread or", "plugin log"], svg: renderCommandFeedbackSvg("error") },
	];

	return canvas(
		1600,
		900,
		`
		<text x="80" y="90" class="eyebrow">ACTION FEEDBACK</text>
		<text x="80" y="146" class="heading">Guarded commands show exactly what is happening.</text>
		<text x="80" y="188" class="body">Review, Ship, and Archive use hold-to-confirm; all command keys target the selected thread.</text>
		${examples
			.map((example, index) => {
				const x = 80 + (index % 3) * 500;
				const y = 250 + Math.floor(index / 3) * 310;
				return `
				<rect x="${x}" y="${y}" width="440" height="250" rx="28" fill="#202228" stroke="#343740" stroke-width="2"/>
				${embeddedSvg(example.svg, x + 30, y + 28, 180, 180)}
				<text x="${x + 238}" y="${y + 80}" class="card-title">${example.title}</text>
				<text x="${x + 238}" y="${y + 120}" class="small">${example.note
					.map((line, lineIndex) => `<tspan x="${x + 238}" dy="${lineIndex === 0 ? 0 : 28}">${line}</tspan>`)
					.join("")}</text>`;
			})
			.join("")}`,
	);
}

function renderPuckGallery(): string {
	const pucks = [
		{ number: 118, name: "LAVA LAMP" },
		{ number: 123, name: "BISMUTH" },
		{ number: 132, name: "ELECTRONICS" },
		{ number: 137, name: "DICHROIC" },
	] as const;

	return canvas(
		1600,
		650,
		`
		<text x="80" y="90" class="eyebrow">SHOW PUCK</text>
		<text x="80" y="146" class="heading">A different companion for every press.</text>
		<text x="80" y="188" class="body">Press for the next variation, or hold to choose one at random.</text>
		${pucks
			.map((puck, index) => {
				const x = 80 + (index % 4) * 380;
				const y = 238;
				return `
				<rect x="${x}" y="${y}" width="330" height="282" rx="28" fill="#202228" stroke="#343740" stroke-width="2"/>
				<rect x="${x + 20}" y="${y + 20}" width="242" height="242" rx="24" fill="#111217"/>
				${embeddedPng(puck.number, x + 20, y + 20, 242, 242)}
				<text x="${x + 282}" y="${y + 60}" class="caption" text-anchor="middle">#${puck.number}</text>
				<text transform="translate(${x + 288} ${y + 100}) rotate(90)" class="puck-name">${puck.name}</text>`;
			})
			.join("")}
		<text x="800" y="586" class="caption" text-anchor="middle">Four examples from 138 bundled variations</text>`,
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
	note: string;
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
		note:
			options.status === "IDLE"
				? "Rotate to browse • press to select • long-touch to open"
				: options.status === "WORKING"
					? "Thread commands stay unavailable while work is active"
					: options.status === "SHIPPING"
						? "Review, Ship, and Archive stay blocked during shipping"
						: "Open and Archive remain available",
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
		<style>
			:root { color-scheme: dark; }
			text { font-family: "Segoe UI", Inter, Arial, sans-serif; }
			.eyebrow { fill: #E7B84B; font-size: 19px; font-weight: 700; letter-spacing: 2px; }
			.heading { fill: #F5F3ED; font-size: 42px; font-weight: 700; }
			.body { fill: #B7BBC4; font-size: 22px; }
			.card-title { fill: #F5F3ED; font-size: 24px; font-weight: 700; letter-spacing: .8px; }
			.caption { fill: #B7BBC4; font-size: 17px; }
			.small { fill: #A6ABB4; font-size: 18px; }
			.puck-name { fill: #F5F3ED; font-size: 13px; font-weight: 700; letter-spacing: .7px; }
		</style>
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
		"com.daniel-insley.amp-deck.sdPlugin",
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
