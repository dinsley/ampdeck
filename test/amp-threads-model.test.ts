import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseThreadMetadataList, projectFromTree } from "../src/amp/amp-threads-model.ts";

describe("amp threads list metadata", () => {
	it("parses metadata and derives the project from a file tree", () => {
		assert.deepEqual(
			parseThreadMetadataList(
				JSON.stringify([
					{
						id: "T-theia",
						title: "Theia UI/UX tickets",
						tree: "file:///Users/dinsley/Projects/personal/theia",
						updated: "2026-07-27T12:00:00.000Z",
					},
				]),
			),
			[
				{
					id: "T-theia",
					title: "Theia UI/UX tickets",
					project: "theia",
					updatedAt: "2026-07-27T12:00:00.000Z",
				},
			],
		);
	});

	it("handles POSIX and Windows paths and rejects malformed inventories", () => {
		assert.equal(projectFromTree("/workspace/ampdeck/"), "ampdeck");
		assert.equal(projectFromTree("C:\\code\\theia"), "theia");
		assert.equal(parseThreadMetadataList("{}"), undefined);
		assert.equal(parseThreadMetadataList('[{"title":"Missing ID"}]'), undefined);
	});
});
