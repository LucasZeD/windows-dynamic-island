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

describe("levelColor", () => {
	test("red at or below the alert level, amber near it, green above", () => {
		expect(levelColor(device({ level: 20 }))).toBe("#FF453A");
		expect(levelColor(device({ level: 35 }))).toBe("#FF9F0A");
		expect(levelColor(device({ level: 36 }))).toBe("#30D158");
	});
	test("green while charging, whatever the level", () => {
		expect(levelColor(device({ level: 5, charging: true }))).toBe("#30D158");
	});
	test("uses the device's own alert level", () => {
		expect(levelColor(device({ level: 30, lowAlertAt: 30 }))).toBe("#FF453A");
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
