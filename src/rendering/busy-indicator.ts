type BusyDot = readonly [x: number, y: number, strength: number];

export const busyIndicatorFrameDurationMs = 500;

const busyFrames: readonly (readonly BusyDot[])[] = [
	[
		[-1, -1, 0.75],
		[1, -1, 1],
		[-1, 1, 1],
		[1, 1, 0.7],
	],
	[
		[-1, -1, 0.65],
		[-1, 0, 1],
		[-1, 1, 0.8],
	],
	[
		[0, -1, 0.7],
		[0, 0, 1],
		[0, 1, 0.75],
	],
	[
		[-1, -1, 0.75],
		[1, -1, 1],
	],
	[
		[-1, 0, 1],
		[1, 0, 0.75],
	],
	[
		[-1, -1, 0.65],
		[0, 0, 1],
		[1, 1, 0.8],
	],
	[
		[-1, 1, 0.75],
		[1, 1, 1],
	],
	[
		[1, -1, 0.65],
		[0, 0, 1],
		[-1, 1, 0.8],
	],
	[
		[-1, -1, 0.6],
		[1, -1, 0.9],
		[-1, 0, 0.8],
		[1, 0, 1],
		[-1, 1, 1],
		[1, 1, 0.7],
	],
	[
		[-1, -1, 0.75],
		[1, -1, 1],
		[-1, 0, 1],
		[1, 0, 0.75],
		[-1, 1, 0.7],
		[1, 1, 0.9],
	],
	[
		[-1, -1, 1],
		[1, -1, 0.7],
		[-1, 0, 0.75],
		[1, 0, 0.9],
		[-1, 1, 1],
		[1, 1, 0.75],
	],
	[
		[1, -1, 0.7],
		[1, 0, 1],
		[1, 1, 0.75],
	],
	[
		[-1, -1, 1],
		[1, -1, 0.7],
		[-1, 1, 0.75],
		[1, 1, 1],
	],
	[
		[-1, -1, 0.65],
		[-1, 0, 1],
		[-1, 1, 0.8],
		[0, 1, 0.55],
	],
];

export type BusyIndicatorOptions = {
	centerX: number;
	centerY: number;
	frame: number;
	dotRadius: number;
	gap: number;
	color?: string;
	opacity?: number;
};

export function renderBusyIndicator(options: BusyIndicatorOptions): string {
	const frameIndex = positiveModulo(Math.floor(options.frame), busyFrames.length);
	const color = options.color ?? "#0B0D0B";
	const opacity = options.opacity ?? 1;
	const dots = busyFrames[frameIndex]
		.map(([x, y, strength]) => {
			const centerX = options.centerX + x * options.gap;
			const centerY = options.centerY + y * options.gap;
			const radius = options.dotRadius * (0.82 + strength * 0.18);
			return `<circle cx="${centerX}" cy="${centerY}" r="${options.dotRadius * 1.9}" fill="${color}" opacity="${0.07 * strength}"/>
			<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="${color}" opacity="${0.42 + strength * 0.58}"/>`;
		})
		.join("\n\t\t\t");

	return `<g data-busy-indicator="morphing-dots" data-busy-frame="${frameIndex}" data-busy-dot-count="${busyFrames[frameIndex].length}" opacity="${opacity}">
			${dots}
		</g>`;
}

export function getBusyIndicatorFrameCount(): number {
	return busyFrames.length;
}

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}
