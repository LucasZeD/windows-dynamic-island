/**
 * GitHub module — followed repositories: open issues and pull requests,
 * stars, the latest release and commit, as a side bubble next to the island
 * and a tab listing each repo (each unfolds into its details). A new release
 * (or push, if wanted) pops up as a toast. Backend counterpart:
 * `src-tauri/src/providers/github/`.
 */
import { GitHubIcon } from "../../components/icons";
import { useProvider } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { GithubBubble } from "./components/GithubBubble";
import { DETAILS_HEIGHT, GithubPanel } from "./components/GithubPanel";
import { GithubSettings } from "./components/GithubSettings";
import { freshIssue, latestUpdate, useUnfolded } from "./repo";
import { githubSettings } from "./settings";
import type { GithubState } from "./types";

const ROW = 42;
/** More repos than this scroll. */
const MAX_VISIBLE_ROWS = 6;

export const githubModule: IslandModule = {
	id: "github",
	title: "github.title",
	settingsIcon: <GitHubIcon size={15} />,
	settings: Object.values(githubSettings),
	SettingsSection: GithubSettings,
	useView(): ModuleView {
		const t = useT();
		const state = useProvider<GithubState>("github");
		const showBubble = useSetting(githubSettings.showBubble);
		const peekOnNew = useSetting(githubSettings.peekOnNew);
		const releases = useSetting(githubSettings.notifyReleases);
		const commits = useSetting(githubSettings.notifyCommits);
		const unfolded = useUnfolded();
		const now = useNow(60_000, !!state?.newIssue);

		const repos = state?.repos ?? [];
		const total = repos.reduce((n, r) => n + (r.openIssues ?? 0), 0);
		const loaded = repos.some((r) => r.openIssues != null);
		const rows = Math.min(Math.max(repos.length, 1), MAX_VISIBLE_ROWS);
		const open = unfolded && repos.some((r) => r.name === unfolded) ? DETAILS_HEIGHT : 0;
		const update = latestUpdate(state, { releases, commits });

		return {
			active: false,
			priority: 0,
			icon: <GitHubIcon size={16} />,
			ambient: showBubble && loaded ? <GithubBubble count={total} fresh={!!freshIssue(state, now)} /> : undefined,
			expanded: <GithubPanel state={state} />,
			expandedSize: { width: 580, height: 70 + rows * ROW + open },
			activityKey: peekOnNew && state?.newIssue ? `${state.newIssue.repo}#${state.newIssue.issue.number}` : undefined,
			notice: update
				? {
						key: `github:${update.repo}:${update.kind}:${update.title}`,
						kind: "toast",
						content: (
							<>
								<GitHubIcon size={15} />
								<span className="truncate text-[13px] font-semibold">
									{update.kind === "release"
										? t("github.toast.release", { repo: update.repo, tag: update.title })
										: t("github.toast.commit", {
												repo: update.branch ? `${update.repo} (${update.branch})` : update.repo,
												title: update.title,
											})}
								</span>
							</>
						),
					}
				: undefined,
		};
	},
};
