/**
 * Cursor: plan usage (Total / Auto / API) and tokens from the Cursor account,
 * with the sign-in Cursor keeps on this computer.
 * Backend: `src-tauri/src/providers/cursor.rs`.
 */
import type { AgentDefinition } from "../common/types";
import { CursorIcon } from "./CursorIcon";
import { CursorSettings } from "./CursorSettings";
import { CURSOR_COLOR, openCursor, useCursor } from "./useCursor";

export const cursorAgent: AgentDefinition = {
	id: "cursor",
	name: "Cursor",
	color: CURSOR_COLOR,
	Icon: CursorIcon,
	// The cube flipping on its axis.
	working: {
		animate: { rotateY: 360 },
		transition: { rotateY: { duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.25 } },
	},
	useAgent: useCursor,
	usageUrl: "https://cursor.com/dashboard?tab=usage",
	openApp: openCursor,
	SettingsSection: CursorSettings,
};
