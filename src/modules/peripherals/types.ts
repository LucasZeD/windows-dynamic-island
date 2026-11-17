import { between, slideColor } from "../../core/levelColor";

/** Mirrors `Device` in `src-tauri/src/providers/peripherals.rs`. */
export interface PeripheralDevice {
	key: string;
	name: string;
	/** 0..100, null while unknown. */
	level: number | null;
	charging: boolean;
	/** False: the level is right but whether it charges isn't known. */
	chargingKnown: boolean;
	/** False: the receiver is there but the device sleeps or is off. */
	online: boolean;
	/** mouse / keyboard / headset / gamepad / … */
	kind: string;
	/** Coarse level text for devices that only report steps. */
	approx: string | null;
	lowAlertAt: number | null;
	secondsLeft: number | null;
}

/** Mirrors `PeripheralsState` in `src-tauri/src/providers/peripherals.rs`. */
export interface PeripheralsState {
	/** The helper is included in this build. */
	available: boolean;
	/** The helper is running and has reported at least once. */
	ready: boolean;
	devices: PeripheralDevice[];
	/** Unix ms of the last report. */
	updatedAt: number;
	/** "missing", "restarting", or a start error. */
	error: string | null;
}

export const PERIPHERALS_PROVIDER = "peripherals";
export const PERIPHERALS_ACCENT = "#64D2FF";

/** Battery left from which the color is plain green. */
const CALM = 70;

/**
 * The system monitor's colors, for battery left: green from `CALM` up,
 * sliding through yellow and orange to red at the device's alert level.
 * Green while charging.
 */
export function levelColor(device: Pick<PeripheralDevice, "level" | "charging" | "lowAlertAt">): string {
	if (device.charging) return slideColor(0);
	const low = Math.min(device.lowAlertAt ?? 20, CALM - 1);
	return slideColor(between(device.level ?? 100, CALM, low));
}

/** Devices on battery at or below their alert level, awake. */
export function lowDevices(devices: PeripheralDevice[]): PeripheralDevice[] {
	return devices.filter((d) => d.online && !d.charging && d.level != null && d.level <= (d.lowAlertAt ?? 20));
}
