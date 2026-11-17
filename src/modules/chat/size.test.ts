import { describe, expect, test } from "bun:test";
import { chatSize } from "./size";

describe("chat size", () => {
	test("defaults to tall 480 × 960", () => {
		expect(chatSize({})).toEqual({ width: 480, height: 960 });
	});

	test("keeps saved sizes within range, junk falls back", () => {
		expect(chatSize({ "chat.width": 720, "chat.height": 514 })).toEqual({ width: 720, height: 514 });
		expect(chatSize({ "chat.width": 10, "chat.height": 99999 })).toEqual({ width: 360, height: 1400 });
		expect(chatSize({ "chat.width": "x", "chat.height": null })).toEqual({ width: 480, height: 960 });
	});
});
