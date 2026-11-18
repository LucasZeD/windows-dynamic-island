/**
 * OpenAI Codex agent. Backend: `src-tauri/src/providers/codex/`.
 */
import { providerAction } from "../../../core/bridge";
import type { AgentDefinition } from "../common/types";
import { CodexIcon } from "./CodexIcon";
import { CodexSettings } from "./CodexSettings";
import { useCodex } from "./useCodex";

export const codexAgent: AgentDefinition = {
	id: "codex",
	name: "Codex",
	color: "#8B9CFF",
	Icon: CodexIcon,
	// OpenAI's knot turning a sixth at a time, like a dial.
	working: {
		animate: { rotate: [0, 60, 120, 180, 240, 300, 360] },
		transition: { rotate: { duration: 2.4, repeat: Infinity, ease: "anticipate" } },
	},
	useAgent: useCodex,
	usageUrl: "https://chatgpt.com/codex/settings/usage",
	openApp: () => providerAction("codex", "openApp"),
	openSession: (session) => {
		if (session.cwd) providerAction("codex", "openProject", session.cwd);
	},
	SettingsSection: CodexSettings,
};
