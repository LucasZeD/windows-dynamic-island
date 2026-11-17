import { describe, expect, test } from "bun:test";
import { formatStat, latestUpdate, parseRepo } from "./repo";
import type { GithubState, GithubUpdate } from "./types";

describe("formatStat", () => {
	test("abbreviates like GitHub", () => {
		expect(formatStat(950)).toBe("950");
		expect(formatStat(1000)).toBe("1k");
		expect(formatStat(1234)).toBe("1.2k");
		expect(formatStat(34_567)).toBe("35k");
		expect(formatStat(1_100_000)).toBe("1.1M");
	});
});

describe("latestUpdate", () => {
	const update = (kind: GithubUpdate["kind"], title: string): GithubUpdate => ({
		repo: "o/r",
		kind,
		title,
		branch: null,
		url: "",
		seenAt: 0,
	});
	const state = { updates: [update("commit", "fix"), update("release", "v2")] } as GithubState;

	test("only what the user wants to hear about, newest first", () => {
		expect(latestUpdate(state, { releases: true, commits: false })?.title).toBe("v2");
		expect(latestUpdate(state, { releases: true, commits: true })?.title).toBe("fix");
		expect(latestUpdate(state, { releases: false, commits: false })).toBeNull();
	});
});

describe("parseRepo", () => {
	test("takes links and owner/name", () => {
		expect(parseRepo("https://github.com/HeyyCzer/windows-dynamic-island/issues")).toBe(
			"HeyyCzer/windows-dynamic-island",
		);
		expect(parseRepo("git@github.com:o/r.git")).toBe("o/r");
		expect(parseRepo("nope")).toBeNull();
	});
});
