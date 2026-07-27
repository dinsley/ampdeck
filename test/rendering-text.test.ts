import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { svgDataUrl } from "../src/rendering/svg-template.ts";
import { escapeXml, splitGraphemes, truncateText } from "../src/rendering/text.ts";

describe("SVG text rendering", () => {
	it("truncates by grapheme without splitting emoji or combining characters", () => {
		assert.equal(truncateText(`${"a".repeat(13)}😀z`, 15), `${"a".repeat(13)}😀z`);
		assert.equal(truncateText(`${"a".repeat(13)}😀zz`, 15), `${"a".repeat(13)}😀…`);
		assert.equal(truncateText("text", 0), "");
		assert.deepEqual(splitGraphemes("e\u0301😀"), ["e\u0301", "😀"]);
	});

	it("normalizes malformed UTF-16 before escaping and encoding", () => {
		const malformed = `bad\uD83D`;
		assert.doesNotThrow(() => svgDataUrl(`<svg>${malformed}</svg>`));
		assert.equal(escapeXml(`<${malformed}&`), "&lt;bad�&amp;");
		assert.equal(escapeXml(`<&"'😀>`), "&lt;&amp;&quot;&apos;😀&gt;");
	});
});
