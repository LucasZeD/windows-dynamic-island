import { describe, expect, test } from "bun:test";
import { pressOutside } from "./useIslandHover";

const press = (o: Partial<Parameters<typeof pressOutside>[0]> = {}) =>
	pressOutside({
		holds: [],
		endsOnPress: new Set(),
		locked: false,
		collapseOnLeave: true,
		pointerInside: false,
		...o,
	});

describe("a click outside the island", () => {
	test("closes it when it closes on click", () => {
		expect(press({ collapseOnLeave: false })).toEqual({ holds: [], close: true });
	});

	test("does nothing when leaving closes it and nothing held it", () => {
		expect(press()).toEqual({ holds: [], close: false });
	});

	test("ends a typing hold and closes it, in both modes", () => {
		const notes = { holds: ["notes"], endsOnPress: new Set(["notes"]) };
		expect(press(notes)).toEqual({ holds: [], close: true });
		expect(press({ ...notes, collapseOnLeave: false })).toEqual({ holds: [], close: true });
	});

	test("ends the typing hold but leaves the island open under the pointer", () => {
		expect(press({ holds: ["notes"], endsOnPress: new Set(["notes"]), pointerInside: true })).toEqual({
			holds: [],
			close: false,
		});
	});

	test("keeps other holds, such as the pin", () => {
		expect(press({ holds: ["pin", "notes"], endsOnPress: new Set(["notes"]) })).toEqual({
			holds: ["pin"],
			close: false,
		});
		expect(press({ holds: ["files"], collapseOnLeave: false })).toEqual({ holds: ["files"], close: false });
	});

	test("never closes it while it's dragged", () => {
		expect(press({ holds: ["notes"], endsOnPress: new Set(["notes"]), locked: true }).close).toBe(false);
		expect(press({ locked: true, collapseOnLeave: false }).close).toBe(false);
	});
});
