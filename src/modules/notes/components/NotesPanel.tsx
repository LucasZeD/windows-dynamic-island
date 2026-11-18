import { FilePlusIcon, FolderOpenIcon, FolderPlusIcon, PanelLeftIcon, PlusIcon, XIcon } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { command } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { useIsland } from "../../../core/island";
import { readSetting, setSetting, useSettings } from "../../../core/settings";
import type { NotesHost } from "../editor/livePreview";
import { flushAllNotes, flushNote, moveNoteState, NoteEditor, type SaveStatus } from "../editor/NoteEditor";
import {
	allNotes,
	findNote,
	NOTES_ACCENT,
	type NotesState,
	noteName,
	notesAction,
	notesSettings,
	parentOf,
	tabs,
} from "../types";
import { NoteTree, type TreeActions } from "./NoteTree";
import "../notes.css";

const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

/** A mini Obsidian: the notes folder as a tree, open notes as tabs, a live-preview editor. */
export function NotesPanel({ state }: { state: NotesState | undefined }) {
	const t = useT();
	const island = useIsland();
	const values = useSettings();
	const openTabs = readSetting(values, notesSettings.tabs);
	const active = readSetting(values, notesSettings.active);
	const expanded = readSetting(values, notesSettings.expanded);
	const sidebar = readSetting(values, notesSettings.sidebar);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [status, setStatus] = useState<SaveStatus>("saved");
	const [error, setError] = useState<string | null>(null);
	const [lightbox, setLightbox] = useState<string | null>(null);
	const tree = state?.tree;
	const treeRef = useRef(tree);
	treeRef.current = tree;
	const valuesRef = useRef(values);
	valuesRef.current = values;

	const notePaths = useMemo(() => new Set(allNotes(tree ?? []).map((n) => n.path)), [tree]);

	// Notes deleted (here or elsewhere) lose their tab.
	useEffect(() => {
		if (tree) tabs.prune(valuesRef.current, (p) => notePaths.has(p));
	}, [tree, notePaths]);

	// The island closing writes what's left.
	// biome-ignore lint/correctness/useExhaustiveDependencies: unmount only
	useEffect(
		() => () => {
			flushAllNotes();
			island.keepOpen(false, "notes");
		},
		[],
	);

	useEffect(() => {
		if (!error) return;
		const timer = window.setTimeout(() => setError(null), 4000);
		return () => window.clearTimeout(timer);
	}, [error]);

	const fail = (e: unknown) => setError(t(String(e) === "exists" ? "notes.exists" : "notes.failed"));

	const expand = (folder: string) => {
		if (!folder) return;
		const list = readSetting(valuesRef.current, notesSettings.expanded);
		const parts = folder.split("/");
		const needed = parts.map((_, i) => parts.slice(0, i + 1).join("/")).filter((p) => !list.includes(p));
		if (needed.length) setSetting(notesSettings.expanded, [...list, ...needed]);
	};

	function openNote(path: string) {
		if (active) flushNote(active, setStatus);
		tabs.open(valuesRef.current, path);
		expand(parentOf(path));
	}

	async function createNote(parent: string, dir: boolean, name?: string) {
		try {
			const path = await notesAction<string>("create", {
				parent,
				name: name ?? t(dir ? "notes.untitledFolder" : "notes.untitled"),
				dir,
			});
			expand(dir ? path : parent);
			if (!dir) openNote(path);
			if (!name) setRenaming(path);
		} catch (e) {
			fail(e);
		}
	}

	/** Moves a note or folder from `from` to `to`; tabs follow before the tree updates. */
	async function relocate(from: string, to: string, run: () => Promise<unknown>) {
		flushAllNotes();
		const before = valuesRef.current;
		tabs.moved(before, from, to);
		moveNoteState(from, to);
		try {
			await run();
		} catch (e) {
			tabs.moved(valuesRef.current, to, from);
			moveNoteState(to, from);
			fail(e);
		}
	}

	const actions: TreeActions = {
		open: openNote,
		create: (parent, dir) => createNote(parent, dir),
		rename(path, name) {
			const isNote = notePaths.has(path);
			const file = isNote && !/\.md$/i.test(name) ? `${name}.md` : name;
			const to = join(parentOf(path), file);
			relocate(path, to, () => notesAction("rename", { path, name }));
		},
		move(path, folder) {
			const to = join(folder, path.split("/").pop() ?? path);
			expand(folder);
			relocate(path, to, () => notesAction("move", { path, to: folder }));
		},
		remove(path) {
			flushAllNotes();
			notesAction("delete", { path }).catch(fail);
		},
		toggle(path) {
			const list = readSetting(valuesRef.current, notesSettings.expanded);
			setSetting(notesSettings.expanded, list.includes(path) ? list.filter((p) => p !== path) : [...list, path]);
		},
	};

	/** A `[[link]]` or `.md` link: the note if it exists, else a new one by that name. */
	function followLink(target: string) {
		const found = findNote(treeRef.current ?? [], target);
		if (found) return openNote(found.path);
		const clean = target.replace(/\.md$/i, "");
		createNote(parentOf(clean), false, clean.split("/").pop());
	}

	const host: NotesHost = {
		note: () => active ?? "",
		openUrl: (url) => {
			notesAction("openLink", url).catch(fail);
		},
		openNote: followLink,
		loadImage: (src) => notesAction<string>("image", { note: active ?? "", src }),
		showImage: setLightbox,
	};

	function closeTab(e: MouseEvent, path: string) {
		e.stopPropagation();
		flushNote(path, setStatus);
		tabs.close(valuesRef.current, path);
	}

	/** The island window must have the keyboard for typing to reach the note. */
	/** Typing keeps the island open wherever the pointer goes; a click outside still closes it. */
	const hold = () => island.keepOpen(true, "notes", { endsOnPressOutside: true });

	function takeKeyboard() {
		// A click back in after one outside: the editor may still have the focus, so no focus event.
		hold();
		if (!document.hasFocus()) command("focus_island");
	}

	function onEscape() {
		if (lightbox) return setLightbox(null);
		if (active) flushNote(active, setStatus);
		(document.activeElement as HTMLElement | null)?.blur();
		command("restore_focus");
		island.collapse();
	}

	const folderName = state?.root.split(/[\\/]/).filter(Boolean).pop() ?? t("notes.title");
	const statusText =
		error ?? (status === "error" ? t("notes.saveFailed") : status === "saving" ? t("notes.saving") : "");

	return (
		<div
			className="relative flex h-full min-h-0 gap-2"
			onMouseDown={takeKeyboard}
			onFocus={hold}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) island.keepOpen(false, "notes");
			}}
			onClick={(e) => e.stopPropagation()}
			data-no-drag
		>
			{sidebar && (
				<aside className="flex w-52 flex-none flex-col gap-1 border-r border-hairline pr-2">
					<div className="flex h-7 flex-none items-center gap-0.5 pl-1">
						<span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-dim" title={state?.root}>
							{folderName}
						</span>
						<HeaderButton title={t("notes.newNote")} onClick={() => createNote("", false)}>
							<FilePlusIcon size={13} />
						</HeaderButton>
						<HeaderButton title={t("notes.newFolder")} onClick={() => createNote("", true)}>
							<FolderPlusIcon size={13} />
						</HeaderButton>
						<HeaderButton title={t("notes.openFolder")} onClick={() => notesAction("openFolder")}>
							<FolderOpenIcon size={13} />
						</HeaderButton>
					</div>
					{state?.error ? (
						<p className="px-2 text-[12px] text-danger">{t("notes.folderError")}</p>
					) : (
						<NoteTree
							tree={tree ?? []}
							active={active}
							expanded={expanded}
							renaming={renaming}
							setRenaming={setRenaming}
							actions={actions}
						/>
					)}
				</aside>
			)}

			<main className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-7 flex-none items-center gap-1">
					<HeaderButton
						title={t(sidebar ? "notes.hideTree" : "notes.showTree")}
						onClick={() => setSetting(notesSettings.sidebar, !sidebar)}
					>
						<PanelLeftIcon size={13} />
					</HeaderButton>
					<div className="notes-tabs flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
						{openTabs.map((path) => (
							<div
								key={path}
								className={cn(
									"group flex h-6.5 max-w-40 min-w-0 flex-none items-center rounded-md pr-1 text-[12px] transition-colors",
									path === active ? "bg-white/10 text-text" : "text-text-dim hover:bg-white/6 hover:text-text",
								)}
							>
								<button
									type="button"
									title={path}
									className="h-full min-w-0 truncate pr-1 pl-2.5"
									onClick={() => openNote(path)}
									onAuxClick={(e) => e.button === 1 && closeTab(e, path)}
								>
									{noteName(path)}
								</button>
								<button
									type="button"
									className={cn(
										"grid size-4 flex-none place-items-center rounded text-text-faint hover:bg-white/12 hover:text-text",
										path !== active && "invisible group-hover:visible",
									)}
									onClick={(e) => closeTab(e, path)}
									title={t("notes.closeTab")}
								>
									<XIcon size={11} />
								</button>
							</div>
						))}
						<HeaderButton title={t("notes.newNote")} onClick={() => createNote(active ? parentOf(active) : "", false)}>
							<PlusIcon size={13} />
						</HeaderButton>
					</div>
					<span className={cn("flex-none text-[11px] text-text-faint", (error || status === "error") && "text-danger")}>
						{statusText}
					</span>
				</div>

				{active ? (
					<div className="min-h-0 flex-1 pt-1">
						<NoteEditor
							path={active}
							host={host}
							placeholderText={t("notes.placeholder")}
							onStatus={setStatus}
							onEscape={onEscape}
						/>
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px] text-text-dim">
						<span>{t("notes.noNote")}</span>
						<button
							type="button"
							className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[12.5px] text-text hover:bg-white/12"
							onClick={() => createNote("", false)}
						>
							<FilePlusIcon size={13} color={NOTES_ACCENT} />
							{t("notes.newNote")}
						</button>
					</div>
				)}
			</main>

			{lightbox && (
				<div
					className="absolute inset-0 z-50 grid place-items-center rounded-xl bg-black/85 p-3"
					onMouseDown={() => setLightbox(null)}
					onKeyDown={(e) => e.key === "Escape" && setLightbox(null)}
				>
					<img src={lightbox} alt="" className="max-h-full max-w-full rounded-lg object-contain" draggable={false} />
				</div>
			)}
		</div>
	);
}

function HeaderButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			title={title}
			className="grid size-6.5 flex-none place-items-center rounded-md text-text-faint transition-colors hover:bg-white/8 hover:text-text"
			onClick={onClick}
		>
			{children}
		</button>
	);
}
