import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { notesAction } from "../types";
import { livePreview, type NotesHost, notesHost, previewHighlight } from "./livePreview";

/** Typing pauses this long before the note is written. */
const SAVE_DELAY_MS = 500;

export type SaveStatus = "saved" | "saving" | "error";

interface Props {
	path: string;
	host: NotesHost;
	placeholderText: string;
	onStatus: (status: SaveStatus) => void;
	onEscape: () => void;
}

/**
 * Each note's editor state (text, cursor, undo history), kept while the app
 * runs so switching tabs, or the island closing, loses nothing.
 */
const states = new Map<string, EditorState>();

/** Writes waiting for a pause in the typing, by note. */
const pending = new Map<string, { content: string; timer: number }>();

function write(path: string, content: string, onStatus: (s: SaveStatus) => void) {
	onStatus("saving");
	notesAction("write", { path, content }).then(
		() => {
			if (!pending.has(path)) onStatus("saved");
		},
		() => onStatus("error"),
	);
}

/** Writes now whatever was waiting (tab switch, island closing, Ctrl+S). */
export function flushNote(path: string, onStatus: (s: SaveStatus) => void = () => {}) {
	const p = pending.get(path);
	if (!p) return;
	window.clearTimeout(p.timer);
	pending.delete(path);
	write(path, p.content, onStatus);
}

export function flushAllNotes() {
	for (const path of [...pending.keys()]) flushNote(path);
}

/** A note renamed or moved: its kept state follows. */
export function moveNoteState(from: string, to: string) {
	for (const [path, state] of [...states]) {
		if (path === from || path.startsWith(`${from}/`)) {
			states.delete(path);
			states.set(to + path.slice(from.length), state);
		}
	}
}

const pictureExt: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

function readBase64(file: Blob) {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

export function NoteEditor({ path, host, placeholderText, onStatus, onEscape }: Props) {
	const parent = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView | null>(null);
	const latest = useRef({ path, host, onStatus, onEscape });
	latest.current = { path, host, onStatus, onEscape };
	/** The path whose text is in the view (null while it loads). */
	const shown = useRef<string | null>(null);

	function extensions(): Extension[] {
		const stableHost: NotesHost = {
			note: () => latest.current.path,
			openUrl: (u) => latest.current.host.openUrl(u),
			openNote: (t) => latest.current.host.openNote(t),
			loadImage: (s) => latest.current.host.loadImage(s),
			showImage: (u) => latest.current.host.showImage(u),
		};
		return [
			history(),
			markdown({ base: markdownLanguage }),
			syntaxHighlighting(previewHighlight),
			EditorView.lineWrapping,
			placeholder(placeholderText),
			notesHost.of(stableHost),
			livePreview(),
			keymap.of([
				{
					key: "Mod-s",
					run: () => {
						flushNote(latest.current.path, latest.current.onStatus);
						return true;
					},
				},
				{
					key: "Escape",
					run: () => {
						latest.current.onEscape();
						return true;
					},
				},
				indentWithTab,
				...historyKeymap,
				...defaultKeymap,
			]),
			EditorView.updateListener.of((u) => {
				const note = shown.current;
				if (!u.docChanged || !note) return;
				const prev = pending.get(note);
				if (prev) window.clearTimeout(prev.timer);
				const content = u.state.doc.toString();
				const status = latest.current.onStatus;
				status("saving");
				pending.set(note, {
					content,
					timer: window.setTimeout(() => flushNote(note, status), SAVE_DELAY_MS),
				});
			}),
			EditorView.domEventHandlers({
				paste(e, v) {
					const file = [...(e.clipboardData?.items ?? [])]
						.find((i) => i.kind === "file" && i.type in pictureExt)
						?.getAsFile();
					if (!file) return false;
					e.preventDefault();
					const note = latest.current.path;
					readBase64(file)
						.then((data) => notesAction<string>("pasteImage", { note, data, ext: pictureExt[file.type] }))
						.then((link) => {
							if (!link || shown.current !== note) return;
							const insert = `![](${link})`;
							v.dispatch(
								v.state.changeByRange((r) => ({
									changes: { from: r.from, to: r.to, insert },
									range: EditorSelection.cursor(r.from + insert.length),
								})),
							);
						})
						.catch(() => latest.current.onStatus("error"));
					return true;
				},
			}),
		];
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: one view for the panel's lifetime
	useEffect(() => {
		if (!parent.current) return;
		const v = new EditorView({ parent: parent.current, state: EditorState.create({ extensions: extensions() }) });
		view.current = v;
		return () => {
			const note = shown.current;
			if (note) {
				states.set(note, v.state);
				flushNote(note);
			}
			v.destroy();
			view.current = null;
		};
	}, []);

	// Another note: keep this one's state, show the other's (from disk, in case it changed).
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on note change only
	useEffect(() => {
		const v = view.current;
		if (!v) return;
		const previous = shown.current;
		if (previous && previous !== path) {
			states.set(previous, v.state);
			flushNote(previous);
		}
		shown.current = null;
		let cancelled = false;
		const cached = states.get(path);
		v.setState(cached ?? EditorState.create({ extensions: extensions() }));
		notesAction<{ content: string }>("read", { path })
			.then((res) => {
				if (cancelled || !view.current) return;
				// A write still waiting is newer than the file.
				const content = pending.get(path)?.content ?? res?.content ?? "";
				if (!cached || cached.doc.toString() !== content) {
					view.current.setState(EditorState.create({ doc: content, extensions: extensions() }));
				}
				shown.current = path;
				latest.current.onStatus("saved");
			})
			.catch(() => {
				if (!cancelled) latest.current.onStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [path]);

	// The panel asks for the window's focus on this press (`focus_island`); the
	// caret comes back once the window has it. Not gated on `document.hasFocus()`,
	// which can be true while the keyboard still goes to another app.
	const onMouseDown = () => {
		window.setTimeout(() => view.current?.focus(), 40);
	};

	// data-scroll: the wheel scrolls the note instead of switching tabs.
	return (
		<div ref={parent} className="notes-editor h-full min-h-0" onMouseDown={onMouseDown} data-no-drag data-scroll />
	);
}
