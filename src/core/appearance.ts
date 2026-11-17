/**
 * Island look, in four parts: the style (notch or island), the theme (dark /
 * light), the material (solid, frosted glass, Liquid Glass) and, for the
 * island, the colored rim.
 */

import { useSyncExternalStore } from "react";
import type { MessageKey } from "./i18n";
import {
	appearanceSettings,
	GLASS_LEVELS,
	type GlassLevel,
	ISLAND_STYLES,
	ISLAND_THEMES,
	type IslandStyle,
	type IslandTheme,
	type LiquidTint,
	MATERIALS,
	type Material,
	readSetting,
	useSettings,
} from "./settings";

export interface BorderPreset {
	id: string;
	name: MessageKey;
	colors: string[];
}

/** "none" is the classic, barely-there hairline. */
export const BORDER_PRESETS: BorderPreset[] = [
	{ id: "none", name: "appearance.preset.none", colors: [] },
	{ id: "intelligence", name: "appearance.preset.intelligence", colors: ["#0894FF", "#C959DD", "#FF2E54", "#FF9004"] },
	{ id: "aurora", name: "appearance.preset.aurora", colors: ["#7F5AF0", "#2CB1FF", "#2CFF9E"] },
	{ id: "sunset", name: "appearance.preset.sunset", colors: ["#FF5F6D", "#FFC371"] },
	{ id: "ocean", name: "appearance.preset.ocean", colors: ["#00C6FF", "#0072FF"] },
	{ id: "claude", name: "appearance.preset.claude", colors: ["#D97757", "#F2B880"] },
	{ id: "neon", name: "appearance.preset.neon", colors: ["#FF00CC", "#3333FF"] },
	{ id: "mono", name: "appearance.preset.mono", colors: ["#FFFFFF", "#6E6E73"] },
];

/** Colors offered for the custom two-color gradient. */
export const PALETTE = [
	"#FF453A",
	"#FF9F0A",
	"#FFD60A",
	"#30D158",
	"#64D2FF",
	"#0A84FF",
	"#5E5CE6",
	"#BF5AF2",
	"#FF375F",
	"#FFFFFF",
];

export const THICKNESSES = [1, 2, 3] as const;

export interface Appearance {
	style: IslandStyle;
	/** The theme in effect (`auto` already resolved). */
	theme: "dark" | "light";
	material: Material;
	liquidTint: LiquidTint;
	/** Floats below the top edge (the island) rather than hanging from it (the notch). */
	floating: boolean;
	/** Floating and resting as a small orb, its news in passing bubbles. */
	orb: boolean;
	tabsPosition: "top" | "bottom";
	/** Gradient stops; empty = classic hairline. */
	rim: string[];
	thickness: number;
	animate: boolean;
	glow: boolean;
	/** How much the desktop behind shows through, blurred: off when solid. */
	glass: GlassLevel;
	idleClock: boolean;
}

export function borderColors(border: string, custom: string[]): string[] {
	if (border === "custom") return custom.length >= 2 ? custom.slice(0, 2) : ["#BF5AF2", "#64D2FF"];
	return BORDER_PRESETS.find((p) => p.id === border)?.colors ?? [];
}

type Values = Record<string, unknown>;

/** The saved style; the old `liquid` style is the island (made of Liquid Glass, see `materialOf`). */
export function styleOf(values: Values): IslandStyle {
	const saved = readSetting<string>(values, appearanceSettings.style);
	if (saved === "liquid") return "windows";
	return ISLAND_STYLES.includes(saved as IslandStyle) ? (saved as IslandStyle) : "dynamic";
}

/** The saved material, or what older settings meant: the `liquid` style, or the glass turned on. */
export function materialOf(values: Values): Material {
	const saved = values[appearanceSettings.material.key];
	if (MATERIALS.includes(saved as Material)) return saved as Material;
	if (values[appearanceSettings.style.key] === "liquid") return "liquid";
	return glassLevel(values[appearanceSettings.glass.key]) === "off" ? "solid" : "frosted";
}

export function themeOf(values: Values): IslandTheme {
	const saved = readSetting(values, appearanceSettings.theme);
	return ISLAND_THEMES.includes(saved) ? saved : "dark";
}

/** How strong the glass is: off when solid, otherwise never off (older installs saved "off"). */
export function glassOf(values: Values, material: Material): GlassLevel {
	if (material === "solid") return "off";
	const level = glassLevel(values[appearanceSettings.glass.key]);
	return level === "off" ? "moderate" : level;
}

export function resolveAppearance(s: Values, systemDark: boolean): Appearance {
	const style = styleOf(s);
	const floating = style !== "dynamic";
	const material = materialOf(s);
	const theme = themeOf(s);
	const tabsPosition = readSetting(s, appearanceSettings.tabsPosition) === "top" ? "top" : "bottom";
	return {
		style,
		theme: theme === "auto" ? (systemDark ? "dark" : "light") : theme,
		material,
		liquidTint: readSetting(s, appearanceSettings.liquidTint) === "tinted" ? "tinted" : "clear",
		floating,
		orb: floating && readSetting(s, appearanceSettings.restShape) !== "pill",
		tabsPosition,
		rim: borderColors(readSetting(s, appearanceSettings.border), readSetting(s, appearanceSettings.customColors)),
		thickness: Math.min(3, Math.max(1, Number(readSetting(s, appearanceSettings.thickness)) || 2)),
		animate: readSetting(s, appearanceSettings.animate),
		glow: readSetting(s, appearanceSettings.glow),
		glass: glassOf(s, material),
		idleClock: readSetting(s, appearanceSettings.idleClock),
	};
}

export function useAppearance(): Appearance {
	return resolveAppearance(useSettings(), useSystemDark());
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void) {
	if (typeof window === "undefined" || !window.matchMedia) return () => {};
	const query = window.matchMedia(DARK_QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

/** Windows' app mode (dark unless it's set to light). */
export function useSystemDark() {
	return useSyncExternalStore(
		subscribeScheme,
		() => typeof window === "undefined" || !window.matchMedia || window.matchMedia(DARK_QUERY).matches,
	);
}

/**
 * The island's fill while there's glass behind it: dark (or light) enough to
 * read on, clear enough to see the blur through.
 */
export function glassTint(look: Pick<Appearance, "theme" | "material" | "liquidTint">): string {
	const light = look.theme === "light";
	if (look.material === "liquid") {
		if (look.liquidTint === "tinted") return light ? "rgb(238 238 244 / 0.8)" : "rgb(6 6 10 / 0.62)";
		return light ? "rgb(250 250 255 / 0.5)" : "rgb(14 14 20 / 0.34)";
	}
	return light ? "rgb(246 246 248 / 0.66)" : "rgb(0 0 0 / 0.55)";
}

/** Anything else stored (an older on/off value) falls back to off. */
export function glassLevel(value: unknown): GlassLevel {
	return GLASS_LEVELS.includes(value as GlassLevel) ? (value as GlassLevel) : "off";
}

/** CSS for the rim: a conic gradient (first color repeated, so it can spin seamlessly). */
export function rimBackground(colors: string[]) {
	if (!colors.length) return undefined;
	const stops = colors.length === 1 ? [colors[0], colors[0]] : [...colors, colors[0]];
	return `conic-gradient(from var(--rim-angle), ${stops.join(", ")})`;
}

/** Swatch fill for a preset in the settings. */
export function swatchBackground(colors: string[]) {
	if (!colors.length) return "#000";
	if (colors.length === 1) return colors[0];
	return `linear-gradient(135deg, ${colors.join(", ")})`;
}
