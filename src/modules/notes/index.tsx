import { NotebookPenIcon } from "lucide-react";
/**
 * Notes — a mini Obsidian: a folder of Markdown files shown as a tree, notes
 * open in tabs, written with a live preview (the Markdown is drawn except on
 * the line being edited) and saved as you type. Links to the web and to other
 * notes (`[[Note]]`), and pasted pictures, which unfold in the note.
 * Backend: `src-tauri/src/providers/notes.rs`.
 */
import { useProvider } from "../../core/bridge";
import type { IslandModule, ModuleView } from "../../core/types";
import { NotesPanel } from "./components/NotesPanel";
import { NotesSettings } from "./components/NotesSettings";
import { NOTES_ACCENT, NOTES_PROVIDER, type NotesState, useNotesSize } from "./types";

export const notesModule: IslandModule = {
	id: "notes",
	title: "notes.title",
	settingsIcon: <NotebookPenIcon size={14} />,
	SettingsSection: NotesSettings,
	useView(): ModuleView {
		const state = useProvider<NotesState>(NOTES_PROVIDER);
		const size = useNotesSize();
		return {
			active: false,
			priority: 0,
			accent: NOTES_ACCENT,
			icon: <NotebookPenIcon size={14} color={NOTES_ACCENT} />,
			expanded: <NotesPanel state={state} />,
			expandedSize: size,
		};
	},
};
