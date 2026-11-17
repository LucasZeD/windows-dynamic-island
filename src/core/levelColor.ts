/** Hues: Apple's green (≈135°) through yellow and orange to red (≈4°). */
const GREEN_HUE = 135;
const RED_HUE = 4;

/**
 * A color on the slide from green (`0`, all good) through yellow and orange to
 * red (`1`, at the limit). Shared by the system monitor (usage) and the
 * peripherals (battery left), so both read the same way.
 */
export function slideColor(t: number): string {
	const clamped = Math.min(1, Math.max(0, t));
	const hue = Math.round(GREEN_HUE + (RED_HUE - GREEN_HUE) * clamped);
	return `hsl(${hue} 90% 56%)`;
}

/** How far `value` is from `calm` (0) to `limit` (1), either direction; outside it, clamped. */
export function between(value: number, calm: number, limit: number): number {
	if (calm === limit) return value === limit ? 1 : 0;
	return Math.min(1, Math.max(0, (value - calm) / (limit - calm)));
}
