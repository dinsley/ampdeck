export type AmpThreadMetadata = {
	id: string;
	title?: string;
	project?: string;
	updatedAt?: string;
};

export function parseThreadMetadataList(output: string): AmpThreadMetadata[] | undefined {
	try {
		const value: unknown = JSON.parse(output);
		if (!Array.isArray(value)) return undefined;

		const threads: AmpThreadMetadata[] = [];
		for (const thread of value as unknown[]) {
			if (!isRecord(thread) || typeof thread.id !== "string") return undefined;
			threads.push({
				id: thread.id,
				title: nonBlankString(thread.title),
				project: projectFromTree(nonBlankString(thread.tree)),
				updatedAt: nonBlankString(thread.updated),
			});
		}
		return threads;
	} catch {
		return undefined;
	}
}

export function projectFromTree(tree: string | undefined): string | undefined {
	if (!tree) return undefined;

	let path = tree;
	try {
		const url = new URL(tree);
		if (url.protocol === "file:") path = decodeURIComponent(url.pathname);
	} catch {
		// Local paths are also valid tree values.
	}

	const segments = path.split(/[\\/]/u).filter(Boolean);
	return nonBlankString(segments.at(-1));
}

function nonBlankString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
