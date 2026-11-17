import { describe, expect, test } from "bun:test";
import { levelColor, lowDevices, type PeripheralDevice } from "./types";

const device = (over: Partial<PeripheralDevice>): PeripheralDevice => ({
	key: "k",
	name: "Mouse",
	level: 50,
	charging: false,
	chargingKnown: true,
	online: true,
	kind: "mouse",
	approx: null,
	lowAlertAt: 20,
	secondsLeft: null,
	...over,
});

const GREEN = "hsl(135 90% 56%)";
const RED = "hsl(4 90% 56%)";
const hue = (color: string) => Number(color.match(/hsl\((\d+)/)?.[1]);

describe("levelColor", () => {
	test("green from 70% up, red at or below the alert level", () => {
		expect(levelColor(device({ level: 100 }))).toBe(GREEN);
		expect(levelColor(device({ level: 70 }))).toBe(GREEN);
		expect(levelColor(device({ level: 20 }))).toBe(RED);
		expect(levelColor(device({ level: 5 }))).toBe(RED);
	});
	test("slides from green to red as the battery drains, like the system monitor", () => {
		const hues = [65, 50, 35, 25].map((level) => hue(levelColor(device({ level }))));
		expect(hues).toEqual([...hues].sort((a, b) => b - a));
		expect(hues[0]).toBeLessThan(135);
		expect(hues[3]).toBeGreaterThan(4);
	});
	test("green while charging, whatever the level", () => {
		expect(levelColor(device({ level: 5, charging: true }))).toBe(GREEN);
	});
	test("uses the device's own alert level", () => {
		expect(levelColor(device({ level: 30, lowAlertAt: 30 }))).toBe(RED);
		expect(levelColor(device({ level: 30 }))).not.toBe(RED);
	});
});

describe("lowDevices", () => {
	test("only awake devices on battery at or below their level", () => {
		const low = device({ key: "low", level: 10 });
		const devices = [
			low,
			device({ key: "charging", level: 10, charging: true }),
			device({ key: "asleep", level: 10, online: false }),
			device({ key: "unknown", level: null }),
			device({ key: "fine", level: 80 }),
		];
		expect(lowDevices(devices)).toEqual([low]);
	});
});
