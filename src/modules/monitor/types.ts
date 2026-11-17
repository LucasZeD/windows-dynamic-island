import { between, slideColor } from "../../core/levelColor";

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

/** Green at low usage, sliding through yellow and orange to red as it climbs. */
export function levelColor(percent: number): string {
	return slideColor(between(percent, CALM, HOT));
}
