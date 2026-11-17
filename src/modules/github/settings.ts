import type { SettingDef } from "../../core/settings";

export const githubSettings = {
	showBubble: {
		key: "github.showBubble",
		label: "github.showBubble.label",
		description: "github.showBubble.desc",
		default: true,
	},
	peekOnNew: {
		key: "github.peekOnNew",
		label: "github.peekOnNew.label",
		description: "github.peekOnNew.desc",
		default: true,
	},
	/** A toast when a followed repo publishes a release. */
	notifyReleases: {
		key: "github.notifyReleases",
		label: "github.notifyReleases.label",
		description: "github.notifyReleases.desc",
		default: true,
	},
	/** A toast on each push to a followed repo's default branch (busy repos push often). */
	notifyCommits: {
		key: "github.notifyCommits",
		label: "github.notifyCommits.label",
		description: "github.notifyCommits.desc",
		default: false,
	},
} satisfies Record<string, SettingDef>;

/** Followed repositories (`owner/name`); also read by the backend provider. */
export const githubRepos: SettingDef<string[]> = {
	key: "github.repos",
	label: "github.repos.title",
	default: [],
};

/** The branch each repo follows for commits, when not its default one (`{ "owner/name": "branch" }`). */
export const githubBranches: SettingDef<Record<string, string>> = {
	key: "github.branches",
	label: "github.branch.label",
	default: {},
};
