import { useSyncExternalStore } from "react";
import type { DockerContainer, DockerEvent, DockerState } from "./types";

export type Tone = "ok" | "warn" | "bad" | "off";

export const TONE_COLOR: Record<Tone, string> = {
	ok: "var(--color-ok)",
	warn: "var(--color-warn)",
	bad: "var(--color-danger)",
	off: "var(--color-text-faint)",
};

/** Mirrors `Container::crashed` in `model.rs`: stopped on its own with an error, or out of memory. */
export function crashed(c: DockerContainer): boolean {
	return (c.state === "exited" || c.state === "dead") && (c.oomKilled || ![0, 130, 137, 143].includes(c.exitCode));
}

export function toneOf(c: DockerContainer): Tone {
	if (c.health === "unhealthy" || crashed(c)) return "bad";
	if (c.state === "restarting" || c.state === "paused" || c.health === "starting") return "warn";
	if (c.state === "running") return "ok";
	return "off";
}

/** In trouble right now (not a past crash): worth the compact island. */
export function inTrouble(c: DockerContainer): boolean {
	return c.state === "restarting" || (c.state === "running" && c.health === "unhealthy");
}

export const isUp = (c: DockerContainer) => c.state === "running" || c.state === "restarting" || c.state === "paused";

/** 40 s, 12 min, 3 h, 5 d. */
export function span(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s} s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h} h`;
	return `${Math.round(h / 24)} d`;
}

/** 950 B, 12.1 MB, 1.4 GB. */
export function bytes(n: number): string {
	const units = ["B", "kB", "MB", "GB", "TB"];
	let i = 0;
	let v = n;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** The name worth reading: the Compose service, or the container's own name. */
export const displayName = (c: DockerContainer) => c.service ?? c.name;

export interface Group {
	/** The Compose project, `null` for containers on their own. */
	project: string | null;
	containers: DockerContainer[];
}

/** Containers by Compose project (alphabetical), the ones on their own last. */
export function groups(containers: DockerContainer[], showStopped: boolean): Group[] {
	const shown = showStopped ? containers : containers.filter((c) => isUp(c) || toneOf(c) === "bad");
	const byProject = new Map<string | null, DockerContainer[]>();
	for (const c of shown) {
		const list = byProject.get(c.project) ?? [];
		list.push(c);
		byProject.set(c.project, list);
	}
	return [...byProject.entries()]
		.sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
		.map(([project, list]) => ({
			project,
			containers: list.sort((a, b) => displayName(a).localeCompare(displayName(b))),
		}));
}

/** The newest event, while it's news. */
export const EVENT_FRESH_MS = 5 * 60_000;
export function freshEvent(state: DockerState | undefined, now: number): DockerEvent | null {
	const e = state?.events?.[0];
	return e && now - e.at < EVENT_FRESH_MS ? e : null;
}

// --- panel layout (its height depends on what's unfolded) -----------------------------

export const ROW = 42;
export const GROUP_HEADER = 26;
export const DETAILS_HEIGHT = 300;
/** Header, padding. */
export const CHROME = 52;
export const MAX_LIST = 470;
/** The Kubernetes view, with and without a pod unfolded. */
export const KUBE_HEIGHT = 380;
export const KUBE_UNFOLDED_HEIGHT = 540;
export const MESSAGE_HEIGHT = 150;

export function listHeight(list: Group[], unfoldedId: string | null): number {
	if (list.length === 0) return MESSAGE_HEIGHT;
	const headers = list.some((g) => g.project) ? list.length * GROUP_HEADER : 0;
	const rows = list.reduce((n, g) => n + g.containers.length, 0) * ROW;
	const open = list.some((g) => g.containers.some((c) => c.id === unfoldedId)) ? DETAILS_HEIGHT : 0;
	return Math.min(headers + rows + open, MAX_LIST + (open ? DETAILS_HEIGHT / 2 : 0)) + CHROME;
}

// --- what's unfolded, shared by the panel and the module's size -----------------------

export type View = "containers" | "kube";

interface Ui {
	view: View;
	/** Container id, or `namespace/pod` in the Kubernetes view. */
	unfolded: string | null;
}

let ui: Ui = { view: "containers", unfolded: null };
const listeners = new Set<() => void>();

export function setUi(next: Partial<Ui>) {
	ui = { ...ui, ...next };
	for (const l of listeners) l();
}

export function useUi(): Ui {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => ui,
	);
}
