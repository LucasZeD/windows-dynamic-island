/**
 * Claude Code agent. Backend: `src-tauri/src/providers/claude/`.
 */
import { providerAction } from "../../../core/bridge";
import type { AgentDefinition } from "../common/types";
import { ClaudeIcon } from "./ClaudeIcon";
import { ClaudeSettings } from "./ClaudeSettings";
import { useClaude } from "./useClaude";

export const claudeAgent: AgentDefinition = {
	id: "claude",
	name: "Claude",
	color: "#D97757",
	Icon: ClaudeIcon,
	// Claude Code's own spinner: the starburst turning and breathing.
	working: {
		animate: { rotate: 360, scale: [1, 0.78, 1] },
		transition: {
			rotate: { duration: 2.6, repeat: Infinity, ease: "linear" },
			scale: { duration: 1.3, repeat: Infinity, ease: "easeInOut" },
		},
	},
	useAgent: useClaude,
	usageUrl: "https://claude.ai/settings/usage",
	openSession: (session) => {
		if (session.cwd) providerAction("claude", "openProject", session.cwd);
	},
	decide: (session, decision) => providerAction("claude", "permission", { id: session.permission?.id, decision }),
	SettingsSection: ClaudeSettings,
};
