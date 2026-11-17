import { BatteryMediumIcon } from "lucide-react";
/**
 * Peripherals — battery of wireless mice, keyboards, headsets and controllers
 * (Razer, Logitech, SteelSeries, HyperX, Corsair, PlayStation, Xbox, Bluetooth…),
 * read by Halo Battery's device code. A device low on battery takes the compact
 * island. Backend: `src-tauri/src/providers/peripherals.rs`.
 */
import { useProvider } from "../../core/bridge";
import type { IslandModule, ModuleView } from "../../core/types";
import { KindIcon, PER_ROW, PeripheralsPanel } from "./components/PeripheralsPanel";
import { peripheralsSettings } from "./settings";
import { levelColor, lowDevices, PERIPHERALS_ACCENT, PERIPHERALS_PROVIDER, type PeripheralsState } from "./types";

/** A card row (84 px) plus the gap; the panel adds its padding and the credit line. */
const ROW_HEIGHT = 92;
const CHROME_HEIGHT = 58;

export const peripheralsModule: IslandModule = {
	id: "peripherals",
	title: "peripherals.title",
	settingsIcon: <BatteryMediumIcon size={14} />,
	settings: Object.values(peripheralsSettings),
	useView(): ModuleView {
		const state = useProvider<PeripheralsState>(PERIPHERALS_PROVIDER);
		const devices = state?.devices ?? [];
		const low = lowDevices(devices);
		const lowest = low.reduce<(typeof low)[number] | undefined>(
			(min, d) => (min == null || (d.level ?? 100) < (min.level ?? 100) ? d : min),
			undefined,
		);
		const rows = Math.min(Math.max(Math.ceil(devices.length / PER_ROW), 1), 2);

		return {
			// A device about to die keeps a spot in the compact island until it's charging.
			active: lowest != null,
			priority: 5,
			accent: PERIPHERALS_ACCENT,
			icon: <BatteryMediumIcon size={14} color={PERIPHERALS_ACCENT} />,
			compact: lowest
				? {
						left: <KindIcon kind={lowest.kind} size={15} color={levelColor(lowest)} />,
						right: (
							<span className="text-[13px] font-semibold tabular-nums" style={{ color: levelColor(lowest) }}>
								{lowest.level}%
							</span>
						),
						width: 220,
					}
				: undefined,
			expanded: <PeripheralsPanel state={state} />,
			expandedSize: { width: 560, height: rows * ROW_HEIGHT + CHROME_HEIGHT },
		};
	},
};
