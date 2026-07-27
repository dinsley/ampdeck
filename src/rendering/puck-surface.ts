import { svgDataUrl } from "./svg-template";

const keySize = 144;

export function renderPuckKeyImage(pngBase64: string, horizontalScale = 1.08): string {
	const scaledWidth = keySize * horizontalScale;
	const width = formatSvgNumber(scaledWidth);
	const x = formatSvgNumber((keySize - scaledWidth) / 2);
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${keySize} ${keySize}">
	<image href="data:image/png;base64,${pngBase64}" x="${x}" y="0" width="${width}" height="${keySize}" preserveAspectRatio="none"/>
</svg>`);
}

function formatSvgNumber(value: number): string {
	return value.toFixed(3).replace(/\.?0+$/u, "");
}
