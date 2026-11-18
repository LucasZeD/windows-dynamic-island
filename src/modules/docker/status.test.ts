import { describe, expect, test } from "bun:test";
import { bytes, crashed, groups, inTrouble, listHeight, ROW, span, toneOf } from "./status";
import type { DockerContainer } from "./types";

const c = (over: Partial<DockerContainer>): DockerContainer => ({
	id: "a2c25381c1e7",
	name: "app-web-1",
	image: "nginx",
	state: "running",
	health: null,
	exitCode: 0,
	oomKilled: false,
	createdAt: 0,
	startedAt: 0,
	finishedAt: 0,
	restartCount: 0,
	project: null,
	service: null,
	ports: [],
	kube: null,
	...over,
});

describe("status", () => {
	test("docker stop isn't a crash, an error exit or running out of memory is", () => {
		expect(crashed(c({ state: "exited", exitCode: 0 }))).toBe(false);
		expect(crashed(c({ state: "exited", exitCode: 143 }))).toBe(false);
		expect(crashed(c({ state: "exited", exitCode: 1 }))).toBe(true);
		expect(crashed(c({ state: "exited", exitCode: 137, oomKilled: true }))).toBe(true);
	});

	test("tones", () => {
		expect(toneOf(c({}))).toBe("ok");
		expect(toneOf(c({ health: "unhealthy" }))).toBe("bad");
		expect(toneOf(c({ health: "starting" }))).toBe("warn");
		expect(toneOf(c({ state: "restarting" }))).toBe("warn");
		expect(toneOf(c({ state: "exited" }))).toBe("off");
		expect(toneOf(c({ state: "exited", exitCode: 2 }))).toBe("bad");
	});

	test("only what's wrong right now is trouble", () => {
		expect(inTrouble(c({ health: "unhealthy" }))).toBe(true);
		expect(inTrouble(c({ state: "restarting" }))).toBe(true);
		expect(inTrouble(c({ state: "exited", exitCode: 2 }))).toBe(false);
	});

	test("span and bytes", () => {
		expect(span(30_000)).toBe("30 s");
		expect(span(12 * 60_000)).toBe("12 min");
		expect(span(5 * 3_600_000)).toBe("5 h");
		expect(span(72 * 3_600_000)).toBe("3 d");
		expect(bytes(950)).toBe("950 B");
		expect(bytes(93_626_761)).toBe("94 MB");
		expect(bytes(1_400_000_000)).toBe("1.4 GB");
	});
});

describe("groups", () => {
	const list = [
		c({ id: "1", name: "solo" }),
		c({ id: "2", project: "shop", service: "web" }),
		c({ id: "3", project: "shop", service: "db", state: "exited" }),
		c({ id: "4", project: "blog", service: "app", state: "exited", exitCode: 1 }),
	];

	test("by project, alphabetical, containers on their own last", () => {
		const g = groups(list, true);
		expect(g.map((x) => x.project)).toEqual(["blog", "shop", null]);
		expect(g[1].containers.map((x) => x.service)).toEqual(["db", "web"]);
	});

	test("hiding stopped containers keeps the crashed ones", () => {
		const g = groups(list, false);
		expect(g.flatMap((x) => x.containers.map((y) => y.id)).sort()).toEqual(["1", "2", "4"]);
	});

	test("the panel grows by the unfolded container's details", () => {
		const g = groups(list, true);
		expect(listHeight(g, "2") - listHeight(g, null)).toBeGreaterThan(ROW);
	});
});
