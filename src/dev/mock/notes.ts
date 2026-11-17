import { art, defineMock, provider } from "./kit";

type Node = { path: string; name: string; dir: boolean; children: Node[] };

/** The notes folder, in memory: folders, and notes with their text. */
const dirs = new Set(["Projects", "Projects/Island"]);
const files = new Map<string, string>([
	[
		"Welcome.md",
		"# Welcome\n\nNotes are **Markdown**, saved as you type.\n\n- [ ] A task\n- [x] Done\n- A [link](https://commonmark.org) and a [[Projects/Island/Ideas|wiki link]]\n\n> A quote\n\n![](attachments/cover.png)\n\n```ts\nconst x = 1;\n```\n",
	],
	["Projects/Island/Ideas.md", "## Ideas\n\n1. Notes in the island\n2. `inline code`\n"],
	["Shopping.md", "- milk\n- bread\n"],
]);

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

function tree(folder: string): Node[] {
	const kids: Node[] = [];
	for (const d of dirs)
		if (parentOf(d) === folder) kids.push({ path: d, name: d.split("/").pop() ?? d, dir: true, children: tree(d) });
	for (const f of files.keys())
		if (parentOf(f) === folder)
			kids.push({ path: f, name: (f.split("/").pop() ?? f).replace(/\.md$/, ""), dir: false, children: [] });
	return kids.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

const state = provider("notes", { root: "C:/Users/me/Documents/Island Notes", tree: tree(""), error: null });
const refresh = () => state.set((s) => ({ ...s, tree: tree("") }));

function unique(folder: string, stem: string, ext: string) {
	for (let n = 0; ; n++) {
		const p = join(folder, `${n ? `${stem} ${n}` : stem}${ext}`);
		if (!files.has(p) && !dirs.has(p)) return p;
	}
}

/** Renames `from` (and everything under it) to `to`. */
function relocate(from: string, to: string) {
	const move = <T>(map: Map<string, T> | Set<string>) => {
		for (const k of [...map.keys()]) {
			if (k !== from && !k.startsWith(`${from}/`)) continue;
			const next = to + k.slice(from.length);
			if (map instanceof Map) {
				map.set(next, map.get(k) as T);
				map.delete(k);
			} else {
				map.delete(k);
				map.add(next);
			}
		}
	};
	move(files);
	move(dirs);
	refresh();
	return to;
}

export const notes = defineMock({
	label: "Notes",
	start: refresh,
	actions: {
		notes: {
			read: (p) => ({ content: files.get((p as { path: string }).path) ?? "" }),
			write: (p) => {
				const { path, content } = p as { path: string; content: string };
				files.set(path, content);
			},
			create: (p) => {
				const { parent, name, dir } = p as { parent: string; name: string; dir: boolean };
				const path = unique(parent, name.replace(/\.md$/, ""), dir ? "" : ".md");
				if (dir) dirs.add(path);
				else files.set(path, "");
				refresh();
				return path;
			},
			rename: (p) => {
				const { path, name } = p as { path: string; name: string };
				const file = files.has(path) && !name.endsWith(".md") ? `${name}.md` : name;
				return relocate(path, join(parentOf(path), file));
			},
			move: (p) => {
				const { path, to } = p as { path: string; to: string };
				return relocate(path, join(to, path.split("/").pop() ?? path));
			},
			delete: (p) => {
				const path = (p as { path: string }).path;
				for (const k of [...files.keys()]) if (k === path || k.startsWith(`${path}/`)) files.delete(k);
				for (const k of [...dirs]) if (k === path || k.startsWith(`${path}/`)) dirs.delete(k);
				refresh();
			},
			image: () => art,
			pasteImage: () => "attachments/Pasted.png",
		},
	},
});
