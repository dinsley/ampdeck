import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAmpThreadUrl } from "../src/amp/thread-url.ts";

describe("Amp thread URL allowlist", () => {
	it("accepts only HTTPS thread paths on the exact Amp host", () => {
		assert.equal(isAmpThreadUrl("https://ampcode.com/threads/T-1234-abcd"), true);
		for (const value of [
			"http://ampcode.com/threads/T-1234",
			"https://evil.example/threads/T-1234",
			"https://ampcode.com.evil.example/threads/T-1234",
			"https://user@ampcode.com/threads/T-1234",
			"https://ampcode.com:444/threads/T-1234",
			"https://ampcode.com/thread/T-1234",
			"https://ampcode.com/threads/not-a-thread",
			"not a URL",
		]) {
			assert.equal(isAmpThreadUrl(value), false, value);
		}
	});
});
