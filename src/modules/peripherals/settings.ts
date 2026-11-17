import type { SettingDef } from "../../core/settings";

/** Also read by the backend (`src-tauri/src/providers/peripherals.rs`). */
export const peripheralsSettings = {
	alerts: {
		key: "peripherals.alerts",
		label: "peripherals.alerts.label",
		description: "peripherals.alerts.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;
