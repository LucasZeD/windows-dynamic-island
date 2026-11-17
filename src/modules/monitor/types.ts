/** Mirrors `MonitorState` in `src-tauri/src/providers/monitor/mod.rs`. */
export interface MonitorState {
	/** Percent. */
	cpu: number | null;
	gpu: number | null;
	/** Bytes. */
	memoryUsed: number | null;
	memoryTotal: number | null;
	/** Bytes per second. */
	down: number | null;
	up: number | null;
	/** Oldest first, one value per second (percentages, bytes/s for the network). */
	history: { cpu: number[]; memory: number[]; gpu: number[]; down: number[]; up: number[] };
	/** Logical processors. */
	cores: number;
}

export const MONITOR_PROVIDER = "monitor";
export const MONITOR_GREEN = "#30D158";
export const NETWORK_BLUE = "#0A84FF";

/** Usage up to here is plain green; from here the color slides toward red. */
const CALM = 30;
/** Usage from here on is full red. */
const HOT = 95;
/** Hues: Apple's green (≈135°) through yellow and orange to red (≈4°). */
const GREEN_HUE = 135;
const RED_HUE = 4;

/** Green at low usage, sliding through yellow and orange to red as it climbs. */
export function levelColor(percent: number): string {
	const t = Math.min(1, Math.max(0, (percent - CALM) / (HOT - CALM)));
	const hue = Math.round(GREEN_HUE + (RED_HUE - GREEN_HUE) * t);
	return `hsl(${hue} 90% 56%)`;
}
