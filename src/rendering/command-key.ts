export function renderCommandKey(options: {
	label: string;
	detail: string;
	color: string;
	dimmed?: boolean;
	footer?: string;
	progress?: number;
	loading?: boolean;
	icon: "archive" | "ship" | "review";
}): string {
	const opacity = options.dimmed ? 0.45 : 1;
	const progress = Math.max(0, Math.min(1, options.progress ?? 0));
	const backgroundColor = options.loading ? "#FFFDF7" : "#FEF3C7";
	const outlineColor = options.loading ? "#EFE9D7" : "#D8C98F";
	const spinnerRotation = ((Date.now() % 2600) / 2600) * 360;
	const spinnerMarkup = options.loading
		? `<circle cx="72" cy="72" r="21" fill="#FFFDF7" opacity=".88"/>
		<g transform="rotate(${spinnerRotation} 72 72)" opacity=".85">
			<circle cx="72" cy="72" r="15" fill="none" stroke="#595959" stroke-opacity=".22" stroke-width="3.2"/>
			<circle cx="72" cy="72" r="15" fill="none" stroke="#595959" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="59 35"/>
		</g>`
		: "";
	const detailMarkup = `<text x="72" y="105" fill="#27251D" opacity="${opacity}" font-family="Segoe UI, sans-serif" font-size="13" font-weight="500" text-anchor="middle">${escapeXml(truncate(options.detail, 15))}</text>`;
	const headerMarkup = renderActionHeader(options.icon, options.label, opacity, 34);
	const progressMarkup =
		options.progress === undefined
			? ""
			: `<rect x="18" y="126" width="108" height="6" rx="3" fill="#DDD2AA"/>
			<rect x="18" y="126" width="${108 * progress}" height="6" rx="3" fill="${options.color}"/>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<style>text { font-family: 'Berkeley Mono V2', monospace !important; }</style>
		<rect width="144" height="144" rx="18" fill="${backgroundColor}"/>
		<rect x="8" y="8" width="128" height="128" rx="14" fill="none" stroke="${outlineColor}" stroke-width="2" opacity="${opacity}"/>
		${headerMarkup}
		${detailMarkup}
		${spinnerMarkup}
		<text x="72" y="118" fill="#665F45" opacity="${opacity}" font-family="Segoe UI, sans-serif" font-size="11" font-weight="600" text-anchor="middle">${escapeXml(options.footer ?? "")}</text>
		${progressMarkup}
	</svg>`;

	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function renderOpenThreadKey(options: { title?: string; dimmed: boolean }): string {
	const opacity = options.dimmed ? 0.4 : 1;
	const title = truncate(options.title ?? "NO THREAD", 15);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<style>text { font-family: 'Berkeley Mono V2', monospace !important; }</style>
		<rect width="144" height="144" rx="18" fill="#FEF3C7"/>
		<rect x="8" y="8" width="128" height="128" rx="14" fill="none" stroke="#D8C98F" stroke-width="2" opacity="${opacity}"/>
		<g transform="translate(58 34) scale(1.1667)" fill="none" stroke="#595959" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">
			<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2zm-10-6h.01M16 11h.01M8 11h.01"/>
		</g>
		<text x="72" y="83" fill="#0B0D0B" opacity="${opacity}" font-size="18" font-weight="700" text-anchor="middle">OPEN</text>
		<text x="72" y="105" fill="#27251D" opacity="${opacity}" font-size="13" font-weight="500" text-anchor="middle">${escapeXml(title)}</text>
	</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export type CommandFeedbackKind = "success" | "sent" | "unavailable" | "error";

export function renderCommandFeedback(kind: CommandFeedbackKind): string {
	const glyph =
		kind === "success" || kind === "sent"
			? `<circle cx="72" cy="62" r="20"/><path d="m62 62 7 7 13-15"/>`
			: kind === "unavailable"
				? `<circle cx="72" cy="62" r="20"/><path d="m58 48 28 28"/>`
				: `<circle cx="72" cy="62" r="20"/><path d="M72 51v14m0 8h.01"/>`;
	const label =
		kind === "success" ? "DONE" : kind === "sent" ? "SENT" : kind === "unavailable" ? "UNAVAILABLE" : "ERROR";
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<style>text { font-family: 'Berkeley Mono V2', monospace !important; }</style>
		<rect width="144" height="144" rx="18" fill="#FFFDF7"/>
		<rect x="8" y="8" width="128" height="128" rx="14" fill="none" stroke="#EFE9D7" stroke-width="2"/>
		<g fill="none" stroke="#595959" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
		<text x="72" y="103" fill="#595959" font-size="${kind === "unavailable" ? 12 : 15}" font-weight="700" text-anchor="middle">${label}</text>
	</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderActionHeader(
	icon: "archive" | "ship" | "review",
	label: string,
	opacity: number,
	iconY: number,
): string {
	const glyph =
		icon === "archive"
			? `<rect width="20" height="5" x="2" y="3" rx="1"/>
			<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8m-10 4h4"/>`
			: icon === "ship"
				? `<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
				<path d="M6 21V9a9 9 0 0 0 9 9"/>`
				: `<path d="M13 5h8m-8 7h8m-8 7h8M3 17l2 2 4-4M3 7l2 2 4-4"/>`;
	return `<g opacity="${opacity}">
		<g transform="translate(58 ${iconY}) scale(1.1667)" fill="none" stroke="#595959" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
		<text x="72" y="${iconY + 49}" fill="#0B0D0B" font-size="18" font-weight="700" text-anchor="middle">${escapeXml(label)}</text>
	</g>`;
}

function truncate(value: string, length: number): string {
	return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
