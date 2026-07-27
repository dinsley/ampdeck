export function renderSvgTemplate(template: string, values: Record<string, string | number>): string {
	return template.replaceAll(/\{\{(\w+)\}\}/g, (_placeholder, key: string) => String(values[key]));
}

export function svgDataUrl(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg.toWellFormed())}`;
}
