import { beforeEach, describe, expect, test } from "bun:test";
import { getSettings, readSetting, setSetting } from "../../core/settings";
import { allNotes, findNote, type NoteNode, noteName, notesSettings, parentOf, remap, tabs } from "./types";

const note = (path: string): NoteNode => ({ path, name: noteName(path), dir: false, children: [] });
const folder = (path: string, children: NoteNode[]): NoteNode => ({
	path,
	name: path.split("/").pop() ?? path,
	dir: true,
	children,
});

const tree = [
	folder("Work", [note("Work/Plan.md"), folder("Work/Old", [note("Work/Old/Plan.md")])]),
	note("Ideas.md"),
	note("Plan.md"),
];

test("names and parents", () => {
	expect(noteName("a/b/My note.md")).toBe("My note");
	expect(noteName("LOUD.MD")).toBe("LOUD");
	expect(noteName("Folder")).toBe("Folder");
	expect(parentOf("a/b/n.md")).toBe("a/b");
	expect(parentOf("n.md")).toBe("");
});

test("every note, depth first", () => {
	expect(allNotes(tree).map((n) => n.path)).toEqual(["Work/Plan.md", "Work/Old/Plan.md", "Ideas.md", "Plan.md"]);
	expect(allNotes([])).toEqual([]);
});

describe("wiki links", () => {
	test("by path first", () => {
		expect(findNote(tree, "Work/Old/Plan")?.path).toBe("Work/Old/Plan.md");
		expect(findNote(tree, "Plan")?.path).toBe("Plan.md");
		expect(findNote(tree, "work/plan.md")?.path).toBe("Work/Plan.md");
	});

	test("else by name anywhere, ignoring case and spaces around", () => {
		expect(findNote([folder("a", [note("a/Deep.md")])], "  deep ")?.path).toBe("a/Deep.md");
	});

	test("nothing for unknown notes or folders", () => {
		expect(findNote(tree, "Nope")).toBeUndefined();
		expect(findNote(tree, "Work")).toBeUndefined();
	});
});

test("paths follow a rename or move", () => {
	expect(remap("a/n.md", "a/n.md", "b/n.md")).toBe("b/n.md");
	expect(remap("a/sub/n.md", "a", "z")).toBe("z/sub/n.md");
	// Only that folder, not one whose name starts the same.
	expect(remap("ab/n.md", "a", "z")).toBe("ab/n.md");
	expect(remap("other.md", "a", "z")).toBe("other.md");
});

describe("tabs", () => {
	const open = () => readSetting(getSettings(), notesSettings.tabs);
	const active = () => readSetting(getSettings(), notesSettings.active);

	beforeEach(() => {
		setSetting(notesSettings.tabs, []);
		setSetting(notesSettings.active, null);
		setSetting(notesSettings.expanded, []);
	});

	test("opening adds a tab once and brings it to front", () => {
		tabs.open(getSettings(), "a.md");
		tabs.open(getSettings(), "b.md");
		tabs.open(getSettings(), "a.md");
		expect(open()).toEqual(["a.md", "b.md"]);
		expect(active()).toBe("a.md");
	});

	test("closing the front tab fronts its neighbour", () => {
		for (const p of ["a.md", "b.md", "c.md"]) tabs.open(getSettings(), p);
		tabs.open(getSettings(), "b.md");
		tabs.close(getSettings(), "b.md");
		expect(open()).toEqual(["a.md", "c.md"]);
		expect(active()).toBe("c.md");
		// The last one: the one before it.
		tabs.close(getSettings(), "c.md");
		expect(active()).toBe("a.md");
		tabs.close(getSettings(), "a.md");
		expect(open()).toEqual([]);
		expect(active()).toBeNull();
	});

	test("closing a tab behind keeps the front one", () => {
		for (const p of ["a.md", "b.md"]) tabs.open(getSettings(), p);
		tabs.close(getSettings(), "a.md");
		expect(active()).toBe("b.md");
	});

	test("tabs and unfolded folders follow a moved folder", () => {
		for (const p of ["w/a.md", "w/sub/b.md", "x.md"]) tabs.open(getSettings(), p);
		tabs.open(getSettings(), "w/sub/b.md");
		setSetting(notesSettings.expanded, ["w", "w/sub", "other"]);
		tabs.moved(getSettings(), "w", "Work");
		expect(open()).toEqual(["Work/a.md", "Work/sub/b.md", "x.md"]);
		expect(active()).toBe("Work/sub/b.md");
		expect(readSetting(getSettings(), notesSettings.expanded)).toEqual(["Work", "Work/sub", "other"]);
	});

	test("notes gone from the folder lose their tab", () => {
		for (const p of ["a.md", "b.md", "c.md"]) tabs.open(getSettings(), p);
		tabs.prune(getSettings(), (p) => p !== "c.md" && p !== "b.md");
		expect(open()).toEqual(["a.md"]);
		expect(active()).toBe("a.md");
		// Nothing gone: nothing changes.
		tabs.prune(getSettings(), () => true);
		expect(open()).toEqual(["a.md"]);
	});
});
