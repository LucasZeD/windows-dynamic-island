import { describe, expect, test } from "bun:test";
import { dodge } from "./useIslandDrag";

describe("dodge", () => {
	// Island 40 px wide at the center of a 1000 px strip: spans 480..520 at offset 0.
	test("leaves a clear island alone", () => {
		expect(dodge(0, 480, 520, [100, 250], -400, 400)).toBe(0);
	});
	test("steps right past buttons ending at the center (left half window)", () => {
		expect(dodge(0, 480, 520, [350, 500], -400, 400)).toBe(30);
	});
	test("takes the shorter way", () => {
		expect(dodge(0, 480, 520, [505, 700], -400, 400)).toBe(-25);
	});
	test("goes the other way when one side has no room", () => {
		expect(dodge(0, 480, 520, [505, 700], -20, 400)).toBe(230);
	});
});
