import { providerAction } from "../../core/bridge";
import { readSetting, type SettingDef, setSetting, useSettings } from "../../core/settings";

export const NOTES_PROVIDER = "notes";
export const NOTES_ACCENT = "#B98BFF";

/** Mirrors `Node` in `src-tauri/src/providers/notes.rs`. */
export interface NoteNode {
	/** Relative to the notes folder, `/`-separated; notes end in `.md`. */
	path: string;
	name: string;
	dir: boolean;
	children: NoteNode[];
}

/** Mirrors `State` in `notes.rs`. */
export interface NotesState {
	root: string;
	tree: NoteNode[];
	error: string | null;
}

export const notesAction = <T = unknown>(action: string, payload?: unknown) =>
	providerAction<T>(NOTES_PROVIDER, action, payload);

export const notesSettings = {
	/** The notes folder (`null`: Documents/Island Notes). Set by the backend's folder picker. */
	folder: { key: "notes.folder", label: "notes.folder.label", default: null as string | null } satisfies SettingDef<
		string | null
	>,
	/** Open tabs, as note paths, and the one in front. */
	tabs: { key: "notes.tabs", label: "notes.title", default: [] as string[] } satisfies SettingDef<string[]>,
	active: { key: "notes.active", label: "notes.title", default: null as string | null } satisfies SettingDef<
		string | null
	>,
	/** Unfolded folders in the tree. */
	expanded: { key: "notes.expanded", label: "notes.title", default: [] as string[] } satisfies SettingDef<string[]>,
	sidebar: { key: "notes.sidebar", label: "notes.title", default: true } satisfies SettingDef<boolean>,
	width: { key: "notes.width", label: "notes.size.width", default: 820 } satisfies SettingDef<number>,
	height: { key: "notes.height", label: "notes.size.height", default: 560 } satisfies SettingDef<number>,
};

export const NOTES_WIDTH = { min: 480, max: 1600 };
export const NOTES_HEIGHT = { min: 300, max: 1400 };

const clamp = (v: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
	typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

export function useNotesSize() {
	const values = useSettings();
	return {
		width: clamp(readSetting(values, notesSettings.width), NOTES_WIDTH, notesSettings.width.default),
		height: clamp(readSetting(values, notesSettings.height), NOTES_HEIGHT, notesSettings.height.default),
	};
}

/** A note's shown name: its file name without `.md`. */
export const noteName = (path: string) => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** The folder part of a path (`a/b/n.md` → `a/b`). */
export const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Every note in the tree, depth first. */
export function allNotes(tree: NoteNode[], out: NoteNode[] = []): NoteNode[] {
	for (const n of tree) {
		if (n.dir) allNotes(n.children, out);
		else out.push(n);
	}
	return out;
}

/** The note a `[[wiki link]]` points at: by path, else by name anywhere (case-insensitive). */
export function findNote(tree: NoteNode[], target: string): NoteNode | undefined {
	const wanted = target.trim().replace(/\.md$/i, "").toLowerCase();
	const notes = allNotes(tree);
	return (
		notes.find((n) => n.path.replace(/\.md$/i, "").toLowerCase() === wanted) ??
		notes.find((n) => n.name.toLowerCase() === wanted)
	);
}

/** After `from` became `to` (rename, move), the paths that pointed into it. */
export function remap(path: string, from: string, to: string) {
	if (path === from) return to;
	if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
	return path;
}

/** Open tabs: persisted in the settings, so they come back with the island. */
export const tabs = {
	open(values: Record<string, unknown>, path: string) {
		const list = readSetting(values, notesSettings.tabs);
		if (!list.includes(path)) setSetting(notesSettings.tabs, [...list, path]);
		setSetting(notesSettings.active, path);
	},
	close(values: Record<string, unknown>, path: string) {
		const list = readSetting(values, notesSettings.tabs);
		const i = list.indexOf(path);
		const next = list.filter((p) => p !== path);
		setSetting(notesSettings.tabs, next);
		if (readSetting(values, notesSettings.active) === path) {
			setSetting(notesSettings.active, next[Math.min(i, next.length - 1)] ?? null);
		}
	},
	/** A note or folder renamed or moved: its tabs follow. */
	moved(values: Record<string, unknown>, from: string, to: string) {
		setSetting(
			notesSettings.tabs,
			readSetting(values, notesSettings.tabs).map((p) => remap(p, from, to)),
		);
		const active = readSetting(values, notesSettings.active);
		if (active) setSetting(notesSettings.active, remap(active, from, to));
		setSetting(
			notesSettings.expanded,
			readSetting(values, notesSettings.expanded).map((p) => remap(p, from, to)),
		);
	},
	/** Notes gone from the folder (deleted here or elsewhere) lose their tab. */
	prune(values: Record<string, unknown>, exists: (path: string) => boolean) {
		const list = readSetting(values, notesSettings.tabs);
		const kept = list.filter(exists);
		if (kept.length === list.length) return;
		setSetting(notesSettings.tabs, kept);
		const active = readSetting(values, notesSettings.active);
		if (active && !exists(active)) setSetting(notesSettings.active, kept[kept.length - 1] ?? null);
	},
};
