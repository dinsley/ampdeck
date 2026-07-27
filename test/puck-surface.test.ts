import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderPuckKeyImage } from "../src/rendering/puck-surface.ts";

describe("Puck key rendering", () => {
	it("widens the on-device image without modifying the source artwork", () => {
		const image = decodeSvgDataUrl(renderPuckKeyImage("cG5n"));

		assert.match(image, /href="data:image\/png;base64,cG5n"/);
		assert.match(image, /x="-5\.76"/);
		assert.match(image, /width="155\.52"/);
		assert.match(image, /height="144"/);
		assert.match(image, /preserveAspectRatio="none"/);
	});

	it("keeps custom compensation centered", () => {
		const image = decodeSvgDataUrl(renderPuckKeyImage("cG5n", 1.1));

		assert.match(image, /x="-7\.2"/);
		assert.match(image, /width="158\.4"/);
	});
});

function decodeSvgDataUrl(value: string): string {
	const prefix = "data:image/svg+xml,";
	assert.ok(value.startsWith(prefix));
	return decodeURIComponent(value.slice(prefix.length));
}
