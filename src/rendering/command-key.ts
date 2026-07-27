import commandFeedbackTemplate from "../assets/command-feedback.svg";
import commandKeyTemplate from "../assets/command-key.svg";
import openThreadKeyTemplate from "../assets/open-thread-key.svg";
import {
	renderCommandFeedbackSvg,
	renderCommandKeySvg,
	renderOpenThreadKeySvg,
	type CommandFeedbackKind,
	type CommandKeyOptions,
} from "./command-surface";
import { svgDataUrl } from "./svg-template";

export type { CommandFeedbackKind } from "./command-surface";

export function renderCommandKey(options: CommandKeyOptions): string {
	return svgDataUrl(renderCommandKeySvg(commandKeyTemplate, options));
}

export function renderOpenThreadKey(options: { title?: string; dimmed: boolean }): string {
	return svgDataUrl(renderOpenThreadKeySvg(openThreadKeyTemplate, options));
}

export function renderCommandFeedback(kind: CommandFeedbackKind): string {
	return svgDataUrl(renderCommandFeedbackSvg(commandFeedbackTemplate, kind));
}
