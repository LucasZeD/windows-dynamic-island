/**
 * Live preview for Markdown in CodeMirror, like Obsidian's: the text stays
 * Markdown, but outside the lines being edited the marks (`#`, `**`, `[]()`…)
 * are hidden and the result is drawn (headings, links, checkboxes, bullets).
 * Pictures show as a chip that unfolds the picture below its line.
 *
 * Decorations come from a state field (not a view plugin) because unfolded
 * pictures are block widgets, which only a state field may provide.
 */
import { ensureSyntaxTree, HighlightStyle, syntaxTree } from "@codemirror/language";
import {
	type EditorState,
	Facet,
	type Range,
	RangeSet,
	StateEffect,
	StateField,
	type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";

/** What the editor needs from the panel around it. */
export interface NotesHost {
	/** Path of the note being edited (pictures resolve from its folder). */
	note: () => string;
	openUrl: (url: string) => void;
	/** A `[[wiki link]]` or a link to another `.md` note. */
	openNote: (target: string) => void;
	/** A picture's `src` as something an `<img>` can show. */
	loadImage: (src: string) => Promise<string>;
	/** Full-size view of a picture. */
	showImage: (url: string) => void;
}

export const notesHost = Facet.define<NotesHost, NotesHost>({ combine: (v) => v[0] });

/** Whether the editor has the keyboard: unfocused, every line is drawn. */
const setFocus = StateEffect.define<boolean>();
const focusField = StateField.define<boolean>({
	create: () => false,
	update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setFocus) ? e.value : acc), v),
});

/** Pictures unfolded below their line, by `src`. */
export const toggleImage = StateEffect.define<string>();
const imagesField = StateField.define<ReadonlySet<string>>({
	create: () => new Set(),
	update(v, tr) {
		let next = v;
		for (const e of tr.effects) {
			if (!e.is(toggleImage)) continue;
			const s = new Set(next);
			if (s.has(e.value)) s.delete(e.value);
			else s.add(e.value);
			next = s;
		}
		return next;
	},
});

const isWeb = (url: string) => /^(https?:|mailto:)/i.test(url);

/** `<a b.png>` and `a%20b.png` alike. */
const cleanUrl = (url: string) => url.trim().replace(/^<|>$/g, "");

const imageCache = new Map<string, Promise<string>>();
function imageUrl(host: NotesHost, src: string) {
	if (/^(https?:|data:)/i.test(src)) return Promise.resolve(src);
	const key = `${host.note()}\n${src}`;
	let p = imageCache.get(key);
	if (!p) {
		p = host.loadImage(src);
		p.catch(() => imageCache.delete(key));
		imageCache.set(key, p);
	}
	return p;
}

class BulletWidget extends WidgetType {
	toDOM() {
		const el = document.createElement("span");
		el.className = "cm-md-bullet";
		el.textContent = "•";
		return el;
	}
	eq() {
		return true;
	}
}

class CheckboxWidget extends WidgetType {
	constructor(readonly checked: boolean) {
		super();
	}
	eq(other: CheckboxWidget) {
		return other.checked === this.checked;
	}
	toDOM(view: EditorView) {
		const box = document.createElement("input");
		box.type = "checkbox";
		box.className = "cm-md-check";
		box.checked = this.checked;
		box.addEventListener("mousedown", (e) => e.preventDefault());
		box.addEventListener("click", (e) => {
			e.preventDefault();
			const pos = view.posAtDOM(box);
			const text = view.state.sliceDoc(pos, pos + 3);
			if (!/^\[[ xX]\]$/.test(text)) return;
			view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" } });
		});
		return box;
	}
	ignoreEvent() {
		return true;
	}
}

/** `![alt](src)` outside the edited line: a chip that unfolds the picture. */
class ImageChipWidget extends WidgetType {
	constructor(
		readonly src: string,
		readonly label: string,
		readonly open: boolean,
	) {
		super();
	}
	eq(o: ImageChipWidget) {
		return o.src === this.src && o.label === this.label && o.open === this.open;
	}
	toDOM(view: EditorView) {
		const chip = document.createElement("span");
		chip.className = `cm-md-image-chip${this.open ? " is-open" : ""}`;
		chip.title = this.src;
		const icon = document.createElement("span");
		icon.className = "cm-md-image-icon";
		icon.textContent = this.open ? "▾" : "▸";
		const text = document.createElement("span");
		text.textContent = this.label;
		chip.append(icon, text);
		chip.addEventListener("mousedown", (e) => {
			e.preventDefault();
			view.dispatch({ effects: toggleImage.of(this.src) });
		});
		return chip;
	}
	ignoreEvent() {
		return true;
	}
}

/** The unfolded picture, below its line. Click: full size. */
class ImageBlockWidget extends WidgetType {
	constructor(
		readonly src: string,
		readonly note: string,
	) {
		super();
	}
	eq(o: ImageBlockWidget) {
		return o.src === this.src && o.note === this.note;
	}
	get estimatedHeight() {
		return 180;
	}
	toDOM(view: EditorView) {
		const host = view.state.facet(notesHost);
		const box = document.createElement("div");
		box.className = "cm-md-image";
		const img = document.createElement("img");
		img.alt = "";
		img.draggable = false;
		box.append(img);
		imageUrl(host, this.src)
			.then((url) => {
				img.src = url;
				img.onload = () => view.requestMeasure();
				img.addEventListener("mousedown", (e) => {
					e.preventDefault();
					host.showImage(url);
				});
			})
			.catch(() => {
				box.classList.add("is-missing");
				box.textContent = `⚠ ${this.src}`;
			});
		return box;
	}
	ignoreEvent() {
		return true;
	}
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const hide = Decoration.replace({});
const line = (cls: string) => Decoration.line({ class: cls });

const WIKI = /\[\[([^\][|#]+)(#[^\][|]*)?(?:\|([^\][]+))?\]\]/g;

/** The decorations for `state` (exported for the tests). */
export function build(state: EditorState): DecorationSet {
	const doc = state.doc;
	const focused = state.field(focusField);
	const images = state.field(imagesField);
	const note = state.facet(notesHost)?.note() ?? "";
	const out: Range<Decoration>[] = [];

	// Lines with a cursor or selection on them show their Markdown.
	const activeLines = new Set<number>();
	if (focused) {
		for (const r of state.selection.ranges) {
			const a = doc.lineAt(r.from).number;
			const b = doc.lineAt(r.to).number;
			for (let n = a; n <= b; n++) activeLines.add(n);
		}
	}
	const active = (from: number, to = from) => {
		const a = doc.lineAt(from).number;
		const b = doc.lineAt(to).number;
		for (let n = a; n <= b; n++) if (activeLines.has(n)) return true;
		return false;
	};
	const hideRange = (from: number, to: number) => {
		if (to > from) out.push(hide.range(from, to));
	};
	const eachLine = (from: number, to: number, deco: Decoration) => {
		for (let pos = from; pos <= to; ) {
			const l = doc.lineAt(pos);
			out.push(deco.range(l.from));
			pos = l.to + 1;
		}
	};
	const child = (node: SyntaxNode, name: string) => {
		for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) return c;
		return null;
	};
	const children = (node: SyntaxNode, name: string) => {
		const list: SyntaxNode[] = [];
		for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) list.push(c);
		return list;
	};

	const tree = ensureSyntaxTree(state, doc.length, 200) ?? syntaxTree(state);
	tree.iterate({
		enter(ref) {
			const node = ref.node;
			const { from, to, name } = node;
			const raw = active(from, to);

			const heading = /^ATXHeading(\d)$/.exec(name) ?? /^SetextHeading(\d)$/.exec(name);
			if (heading) {
				out.push(line(`cm-md-h${heading[1]}`).range(doc.lineAt(from).from));
				const mark = child(node, "HeaderMark");
				if (!raw && mark && name.startsWith("ATX")) {
					const space = doc.sliceString(mark.to, mark.to + 1) === " " ? 1 : 0;
					hideRange(mark.from, mark.to + space);
					// Closing `##`, if any.
					const end = children(node, "HeaderMark")[1];
					if (end) hideRange(end.from, end.to);
				}
				return;
			}

			switch (name) {
				case "Emphasis":
				case "StrongEmphasis":
				case "Strikethrough":
					if (!raw) {
						for (const m of children(node, name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark")) {
							hideRange(m.from, m.to);
						}
					}
					return;
				case "InlineCode":
					out.push(Decoration.mark({ class: "cm-md-code" }).range(from, to));
					if (!raw) for (const m of children(node, "CodeMark")) hideRange(m.from, m.to);
					return false;
				case "FencedCode":
				case "CodeBlock": {
					const first = doc.lineAt(from).number;
					const last = doc.lineAt(to).number;
					for (let n = first; n <= last; n++) {
						const cls = ["cm-md-codeblock", n === first && "is-first", n === last && "is-last"]
							.filter(Boolean)
							.join(" ");
						out.push(line(cls).range(doc.line(n).from));
					}
					return false;
				}
				case "Blockquote":
					eachLine(from, to, line("cm-md-quote"));
					return;
				case "QuoteMark":
					if (!raw) {
						const space = doc.sliceString(to, to + 1) === " " ? 1 : 0;
						hideRange(from, to + space);
					}
					return;
				case "HorizontalRule":
					out.push(line("cm-md-hr").range(doc.lineAt(from).from));
					if (!raw) hideRange(from, to);
					return;
				case "ListItem": {
					const mark = child(node, "ListMark");
					if (!mark || raw || active(from)) return;
					const task = child(node, "Task");
					const isBullet = /^[-*+]$/.test(doc.sliceString(mark.from, mark.to));
					if (task) {
						// `- [ ]` → a checkbox.
						const marker = child(task, "TaskMarker");
						if (marker) {
							if (isBullet) hideRange(mark.from, marker.from);
							const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
							out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(marker.from, marker.to));
							if (checked) {
								const end = doc.lineAt(marker.to).to;
								if (end > marker.to + 1) out.push(Decoration.mark({ class: "cm-md-done" }).range(marker.to + 1, end));
							}
						}
					} else if (isBullet) {
						out.push(bullet.range(mark.from, mark.to));
					}
					return;
				}
				case "Link": {
					const url = child(node, "URL");
					const marks = children(node, "LinkMark");
					if (!url || marks.length < 2) return; // reference links: left as typed
					const href = cleanUrl(doc.sliceString(url.from, url.to));
					const textFrom = marks[0].to;
					const textTo = marks[1].from;
					const attrs = { class: "cm-md-link", "data-href": href };
					if (raw) {
						out.push(Decoration.mark({ class: "cm-md-url" }).range(url.from, url.to));
						return false;
					}
					if (textTo > textFrom) {
						hideRange(from, textFrom);
						out.push(Decoration.mark({ attributes: attrs }).range(textFrom, textTo));
						hideRange(textTo, to);
					} else {
						// `[](url)`: show the address.
						out.push(Decoration.replace({}).range(from, url.from));
						out.push(Decoration.mark({ attributes: attrs }).range(url.from, url.to));
						hideRange(url.to, to);
					}
					return false;
				}
				case "Image": {
					const url = child(node, "URL");
					if (!url) return false;
					const src = cleanUrl(doc.sliceString(url.from, url.to));
					const marks = children(node, "LinkMark");
					const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from).trim() : "";
					const open = images.has(src);
					if (!raw) {
						const label = alt || decodeURIComponent(src.split("/").pop() ?? src);
						out.push(Decoration.replace({ widget: new ImageChipWidget(src, label, open) }).range(from, to));
					} else {
						out.push(Decoration.mark({ class: "cm-md-url" }).range(url.from, url.to));
					}
					if (open) {
						out.push(
							Decoration.widget({ widget: new ImageBlockWidget(src, note), block: true, side: 1 }).range(
								doc.lineAt(to).to,
							),
						);
					}
					return false;
				}
				case "URL":
				case "Autolink": {
					// Bare addresses (GFM autolinks).
					const parent = node.parent?.name;
					if (parent === "Link" || parent === "Image") return;
					const href = doc.sliceString(from, to).replace(/^<|>$/g, "");
					if (!/^(https?:\/\/|www\.|mailto:)/i.test(href)) return;
					out.push(
						Decoration.mark({
							class: "cm-md-link",
							attributes: { "data-href": href.startsWith("www.") ? `https://${href}` : href },
						}).range(from, to),
					);
					return false;
				}
			}
		},
	});

	// `[[wiki links]]`, which the Markdown parser doesn't know.
	const text = doc.toString();
	for (const m of text.matchAll(WIKI)) {
		const from = m.index ?? 0;
		const to = from + m[0].length;
		const inner = tree.resolveInner(from + 2, 1);
		if (/Code|URL/.test(inner.name) || /Code/.test(inner.parent?.name ?? "")) continue;
		const target = m[1].trim();
		const deco = Decoration.mark({ class: "cm-md-link cm-md-wiki", attributes: { "data-note": target } });
		if (active(from, to)) {
			out.push(deco.range(from, to));
		} else {
			const shownFrom = m[3] ? to - 2 - m[3].length : from + 2;
			hideRange(from, shownFrom);
			out.push(deco.range(shownFrom, to - 2));
			hideRange(to - 2, to);
		}
	}

	return RangeSet.of(out, true);
}

const previewField = StateField.define<DecorationSet>({
	create: (state) => build(state),
	update(deco, tr: Transaction) {
		const refocus = tr.effects.some((e) => e.is(setFocus) || e.is(toggleImage));
		if (tr.docChanged || tr.selection || refocus) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

/** Clicks on drawn links open them; Ctrl+click works on the Markdown too. */
const linkClicks = EditorView.domEventHandlers({
	mousedown(e, view) {
		if (e.button !== 0) return false;
		const el = (e.target as HTMLElement).closest<HTMLElement>(".cm-md-link, .cm-md-url");
		if (!el) return false;
		const host = view.state.facet(notesHost);
		const pos = view.posAtDOM(el);
		const lineActive =
			view.hasFocus &&
			view.state.selection.ranges.some(
				(r) => view.state.doc.lineAt(r.head).number === view.state.doc.lineAt(pos).number,
			);
		if (lineActive && !(e.ctrlKey || e.metaKey)) return false;
		let href = el.dataset.href ?? (el.classList.contains("cm-md-url") ? cleanUrl(el.textContent ?? "") : undefined);
		const wiki = el.dataset.note;
		e.preventDefault();
		if (wiki) host.openNote(wiki);
		else if (href) {
			href = href.trim();
			if (isWeb(href)) host.openUrl(href);
			else if (/\.md(#.*)?$/i.test(href)) host.openNote(resolveNoteLink(host.note(), href));
		}
		return true;
	},
});

/** A relative `.md` link in `note`, as a path from the notes folder. */
export function resolveNoteLink(note: string, href: string) {
	const clean = decodeURIComponent(href.split("#")[0]);
	const parts = clean.startsWith("/") ? [] : note.split("/").slice(0, -1);
	for (const p of clean.split("/")) {
		if (!p || p === ".") continue;
		if (p === "..") parts.pop();
		else parts.push(p);
	}
	return parts.join("/");
}

export const previewHighlight = HighlightStyle.define([
	{ tag: tags.strong, fontWeight: "700" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.6" },
	{ tag: tags.link, color: "var(--accent)" },
	{ tag: tags.url, color: "var(--text-faint)" },
	{ tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--text-faint)" },
	{ tag: tags.quote, color: "var(--text-dim)" },
	{ tag: tags.monospace, fontFamily: "var(--notes-mono)" },
	{ tag: tags.heading, fontWeight: "700" },
	{ tag: [tags.keyword, tags.operator], color: "#c062d6" },
	{ tag: [tags.string, tags.special(tags.string)], color: "#3fa45b" },
	{ tag: [tags.number, tags.bool, tags.atom], color: "#d9822b" },
	{ tag: tags.comment, color: "var(--text-faint)", fontStyle: "italic" },
	{ tag: [tags.function(tags.variableName), tags.typeName, tags.className], color: "#4a86e8" },
]);

export function livePreview() {
	return [
		focusField,
		imagesField,
		previewField,
		linkClicks,
		EditorView.focusChangeEffect.of((_, focusing) => setFocus.of(focusing)),
	];
}
