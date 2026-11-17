/** Mirrors `src-tauri/src/providers/github/mod.rs`. */
export interface GithubIssue {
	number: number;
	title: string;
	url: string;
	author: string | null;
	/** ISO 8601. */
	createdAt: string;
}

export type GithubErrorCode = "notFound" | "unauthorized" | "rateLimited" | "network" | "http";

/** Mirrors `api::RepoInfo`. */
export interface GithubRepoInfo {
	stars: number;
	forks: number;
	openIssuesAndPrs: number;
	language: string | null;
	description: string | null;
	/** ISO 8601. */
	pushedAt: string | null;
	defaultBranch: string | null;
}

export interface GithubRelease {
	tag: string;
	name: string | null;
	url: string;
	/** ISO 8601. */
	publishedAt: string;
}

export interface GithubCommit {
	sha: string;
	title: string;
	author: string | null;
	url: string;
	/** ISO 8601. */
	date: string;
}

export interface GithubRepo {
	/** `owner/name`. */
	name: string;
	/** Followed for commits; null: the default branch. */
	branch: string | null;
	openIssues: number | null;
	latest: GithubIssue | null;
	error: GithubErrorCode | null;
	info: GithubRepoInfo | null;
	openPrs: number | null;
	release: GithubRelease | null;
	commit: GithubCommit | null;
}

/** A release or a push seen while the app ran. */
export interface GithubUpdate {
	repo: string;
	kind: "release" | "commit";
	/** The tag, or the commit's first line. */
	title: string;
	/** The commit's branch, when not the default one. */
	branch: string | null;
	url: string;
	seenAt: number;
}

export interface GithubState {
	repos: GithubRepo[];
	auth: "none" | "token" | "gh";
	login: string | null;
	/** The saved token was rejected. */
	authError: boolean;
	rateLimitedUntil: number | null;
	loading: boolean;
	updatedAt: number | null;
	/** Issue that appeared since the previous poll. */
	newIssue: { repo: string; issue: GithubIssue; seenAt: number } | null;
	/** Newest first. */
	updates: GithubUpdate[];
}
