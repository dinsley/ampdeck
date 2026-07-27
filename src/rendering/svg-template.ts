export function renderSvgTemplate(template: string, values: Record<string, string | number>): string {
	return template.replaceAll(/\{\{(\w+)\}\}/g, (_placeholder, key: string) => {
		if (!(key in values)) throw new Error(`Missing SVG template value: ${key}`);
		return String(values[key]);
	});
}

export function svgDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg.toWellFormed())}`;
}
