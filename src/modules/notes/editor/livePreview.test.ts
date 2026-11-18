import { describe, expect, test } from "bun:test";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { build, livePreview, resolveNoteLink } from "./livePreview";

/** What the preview draws for `doc` while the editor doesn't have the keyboard. */
function drawn(doc: string) {
	const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), livePreview()] });
	const out: string[] = [];
	build(state).between(0, doc.length, (from, to, deco) => {
		const spec = deco.spec as { class?: string; widget?: object; attributes?: Record<string, string> };
		const text = doc.slice(from, to);
		if (spec.widget) out.push(`widget:${spec.widget.constructor.name}:${text}`);
		else if (from === to) out.push(`line:${spec.class}`);
		else if (spec.class || spec.attributes) {
			out.push(
				`mark:${spec.class ?? spec.attributes?.class}:${text}${spec.attributes?.["data-href"] ? `→${spec.attributes["data-href"]}` : ""}${spec.attributes?.["data-note"] ? `→${spec.attributes["data-note"]}` : ""}`,
			);
		} else out.push(`hide:${text}`);
	});
	return out;
}

describe("live preview", () => {
	test("headings hide their marks", () => {
		expect(drawn("## Title")).toEqual(["line:cm-md-h2", "hide:## "]);
	});

	test("emphasis and code hide their marks", () => {
		const d = drawn("a **b** `c`");
		expect(d.filter((x) => x === "hide:**")).toHaveLength(2);
		expect(d.filter((x) => x === "hide:`")).toHaveLength(2);
		expect(d).toContain("mark:cm-md-code:`c`");
	});

	test("links show their text and keep the address", () => {
		expect(drawn("[site](https://x.dev)")).toEqual([
			"hide:[",
			"mark:cm-md-link:site→https://x.dev",
			"hide:](https://x.dev)",
		]);
	});

	test("bare addresses are links", () => {
		expect(drawn("see https://x.dev now")).toContain("mark:cm-md-link:https://x.dev→https://x.dev");
	});

	test("wiki links", () => {
		expect(drawn("go [[Ideas]]")).toEqual(["hide:[[", "mark:cm-md-link cm-md-wiki:Ideas→Ideas", "hide:]]"]);
		expect(drawn("[[a/Plan|the plan]]")).toEqual([
			"hide:[[a/Plan|",
			"mark:cm-md-link cm-md-wiki:the plan→a/Plan",
			"hide:]]",
		]);
		// Not inside code.
		expect(drawn("`[[x]]`").some((x) => x.includes("wiki"))).toBe(false);
	});

	test("pictures are chips", () => {
		expect(drawn("![](attachments/a%20b.png)")).toEqual(["widget:ImageChipWidget:![](attachments/a%20b.png)"]);
	});

	test("tasks are checkboxes and bullets are dots", () => {
		expect(drawn("- [x] done")).toEqual(["hide:- ", "widget:CheckboxWidget:[x]", "mark:cm-md-done:done"]);
		expect(drawn("- item")).toEqual(["widget:BulletWidget:-"]);
	});

	test("quotes and code blocks style their lines", () => {
		expect(drawn("> hi")).toEqual(["line:cm-md-quote", "hide:> "]);
		expect(drawn("```\nx\n```")).toEqual([
			"line:cm-md-codeblock is-first",
			"line:cm-md-codeblock",
			"line:cm-md-codeblock is-last",
		]);
	});
});

test("note links resolve from the note's folder", () => {
	expect(resolveNoteLink("a/b/n.md", "../Other%20note.md#part")).toBe("a/Other note.md");
	expect(resolveNoteLink("n.md", "sub/x.md")).toBe("sub/x.md");
	expect(resolveNoteLink("a/n.md", "./x.md")).toBe("a/x.md");
	// A leading slash starts at the notes folder.
	expect(resolveNoteLink("a/b/n.md", "/top.md")).toBe("top.md");
	// Climbing past the top stays at the top.
	expect(resolveNoteLink("n.md", "../../x.md")).toBe("x.md");
});

describe("more live preview", () => {
	test("deeper headings and plain text", () => {
		expect(drawn("### Small")).toEqual(["line:cm-md-h3", "hide:### "]);
		expect(drawn("just words")).toEqual([]);
	});

	test("open tasks are checkboxes without the done mark", () => {
		expect(drawn("- [ ] todo")).toEqual(["hide:- ", "widget:CheckboxWidget:[ ]"]);
	});

	test("addresses inside code aren't links", () => {
		expect(drawn("`https://x.dev`").some((x) => x.includes("cm-md-link"))).toBe(false);
	});
});
