import { useSyncExternalStore } from "react";
import type { GithubState, GithubUpdate } from "./types";

/** `https://github.com/o/r/issues`, `git@github.com:o/r.git` or `o/r` → `o/r`. */
export function parseRepo(input: string): string | null {
	const s = input
		.trim()
		.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
		.replace(/^git@github\.com:/i, "");
	const m = /^([\w.-]+)\/([\w.-]+?)(\.git)?(?:[/?#].*)?$/.exec(s);
	return m ? `${m[1]}/${m[2]}` : null;
}

/** A new issue keeps its highlight for this long; so does a new release or push. */
export const NEW_ISSUE_MS = 15 * 60_000;

export function freshIssue(state: GithubState | undefined, now: number) {
	const n = state?.newIssue;
	return n && now - n.seenAt < NEW_ISSUE_MS ? n : null;
}

/** The newest release or push the user wants to hear about. */
export function latestUpdate(
	state: GithubState | undefined,
	wanted: { releases: boolean; commits: boolean },
): GithubUpdate | null {
	return state?.updates?.find((u) => (u.kind === "release" ? wanted.releases : wanted.commits)) ?? null;
}

/** The repo's newest release or push, while it's fresh. */
export function freshUpdate(state: GithubState | undefined, repo: string, now: number) {
	return state?.updates?.find((u) => u.repo === repo && now - u.seenAt < NEW_ISSUE_MS) ?? null;
}

export const formatCount = (n: number) => (n > 99 ? "99+" : String(n));

/** 950, 1.2k, 34k, 1.1M. */
export function formatStat(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** ISO 8601 → ms; 0 when missing. */
export const isoMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

// --- the repo unfolded in the panel (its height depends on it) ------------------------

let unfolded: string | null = null;
const listeners = new Set<() => void>();

export function setUnfolded(repo: string | null) {
	unfolded = repo;
	for (const l of listeners) l();
}

export function useUnfolded(): string | null {
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => unfolded,
	);
}
