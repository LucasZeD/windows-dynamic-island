import { describe, expect, test } from "bun:test";
import { glassOf, glassTint, materialOf, resolveAppearance, styleOf } from "./appearance";

describe("appearance", () => {
	test("the old liquid style is the island in Liquid Glass", () => {
		const old = { "appearance.style": "liquid", "appearance.glass": "off" };
		expect(styleOf(old)).toBe("windows");
		expect(materialOf(old)).toBe("liquid");
		// Glass is never off while the material is glass.
		expect(glassOf(old, "liquid")).toBe("moderate");
	});

	test("older settings: glass on means frosted, off means solid", () => {
		expect(materialOf({ "appearance.glass": "strong" })).toBe("frosted");
		expect(materialOf({ "appearance.glass": "off" })).toBe("solid");
		expect(materialOf({})).toBe("solid");
	});

	test("a saved material wins over the old settings", () => {
		expect(materialOf({ "appearance.style": "liquid", "appearance.material": "solid" })).toBe("solid");
		expect(glassOf({ "appearance.glass": "strong" }, "solid")).toBe("off");
	});

	test("auto follows the system", () => {
		const auto = { "appearance.theme": "auto" };
		expect(resolveAppearance(auto, true).theme).toBe("dark");
		expect(resolveAppearance(auto, false).theme).toBe("light");
		expect(resolveAppearance({}, false).theme).toBe("dark");
		expect(resolveAppearance({ "appearance.theme": "light" }, true).theme).toBe("light");
	});

	test("tinted liquid glass is more opaque than clear, in both themes", () => {
		const alpha = (tint: string) => Number(tint.match(/\/ ([\d.]+)\)/)?.[1]);
		for (const theme of ["dark", "light"] as const) {
			const clear = glassTint({ theme, material: "liquid", liquidTint: "clear" });
			const tinted = glassTint({ theme, material: "liquid", liquidTint: "tinted" });
			expect(alpha(tinted)).toBeGreaterThan(alpha(clear));
		}
	});
});
