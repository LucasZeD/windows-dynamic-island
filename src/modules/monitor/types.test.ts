import { describe, expect, test } from "bun:test";
import { levelColor } from "./types";

const hue = (color: string) => Number(/hsl\((\d+)/.exec(color)?.[1]);

describe("levelColor", () => {
	test("green when calm, red when maxed", () => {
		expect(hue(levelColor(0))).toBe(135);
		expect(hue(levelColor(30))).toBe(135);
		expect(hue(levelColor(95))).toBe(4);
		expect(hue(levelColor(100))).toBe(4);
	});

	test("slides from green to red as usage climbs", () => {
		const hues = [40, 55, 70, 85].map((p) => hue(levelColor(p)));
		for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeLessThan(hues[i - 1]);
	});
});
