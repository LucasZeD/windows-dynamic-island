/**
 * Google Antigravity: plan quota read from the app's local language server.
 * Backend: `src-tauri/src/providers/antigravity.rs`.
 */
import type { AgentDefinition } from "../common/types";
import { AntigravityIcon } from "./AntigravityIcon";
import { AntigravitySettings } from "./AntigravitySettings";
import { useAntigravity } from "./useAntigravity";

export const antigravityAgent: AgentDefinition = {
	id: "antigravity",
	name: "Antigravity",
	color: "#388BFD",
	Icon: AntigravityIcon,
	// Floating, as the name says.
	working: {
		animate: { y: [0, -3, 0], rotate: [-6, 6, -6] },
		transition: {
			y: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
			rotate: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
		},
	},
	useAgent: useAntigravity,
	SettingsSection: AntigravitySettings,
};
