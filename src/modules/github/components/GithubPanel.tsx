import {
	ChevronDownIcon,
	CircleDotIcon,
	GitCommitHorizontalIcon,
	GitForkIcon,
	GitPullRequestIcon,
	RefreshCwIcon,
	StarIcon,
	TagIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { IconButton, LinkButton } from "../../../components/ui/button";
import { SectionLabel } from "../../../components/ui/text";
import { command, providerAction } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { formatAgo, useNow } from "../../ai-agents/common/format";
import { formatCount, formatStat, freshIssue, freshUpdate, isoMs, setUnfolded, useUnfolded } from "../repo";
import type { GithubRepo, GithubState, GithubUpdate } from "../types";

const open = (url: string) => providerAction("github", "open", { url });

/** Height of a repo's dropdown (px), for the panel's size (`index.tsx`). */
export const DETAILS_HEIGHT = 150;

/** Expanded panel: one row per followed repository, each unfolding into its details. */
export function GithubPanel({ state }: { state: GithubState | undefined }) {
	const t = useT();
	const now = useNow(30_000);
	const repos = state?.repos ?? [];
	const fresh = freshIssue(state, now);
	const unfolded = useUnfolded();

	let meta = "";
	if (state?.rateLimitedUntil && state.rateLimitedUntil > now) {
		const time = new Date(state.rateLimitedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		meta = t("github.rateLimited", { time });
	} else if (state?.loading) meta = t("github.loading");
	else if (state?.updatedAt) meta = t("github.updated", { time: formatAgo(t, state.updatedAt, now) });

	return (
		<div className="flex h-full flex-col gap-2">
			<div className="flex h-5.5 flex-none items-center gap-2.5">
				<SectionLabel>{t("github.repos.title")}</SectionLabel>
				<span className="flex-1 text-[11.5px] text-text-faint">{meta}</span>
				<IconButton
					size="sm"
					tone="faint"
					className={state?.loading ? "[&_svg]:animate-spin-fast" : undefined}
					title={t("github.refresh")}
					onClick={() => providerAction("github", "refresh")}
				>
					<RefreshCwIcon size={14} />
				</IconButton>
			</div>

			{repos.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-[13px] text-text-dim">
					<span>{t("github.empty")}</span>
					<LinkButton onClick={() => command("open_settings")}>{t("github.addInSettings")}</LinkButton>
				</div>
			) : (
				<div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto [scrollbar-width:none]">
					{repos.map((repo) => (
						<RepoRow
							key={repo.name}
							repo={repo}
							now={now}
							unfolded={unfolded === repo.name}
							freshIssue={fresh?.repo === repo.name && fresh.issue.number === repo.latest?.number}
							update={freshUpdate(state, repo.name, now)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function RepoRow({
	repo,
	now,
	unfolded,
	freshIssue,
	update,
}: {
	repo: GithubRepo;
	now: number;
	unfolded: boolean;
	freshIssue: boolean;
	update: GithubUpdate | null;
}) {
	const t = useT();
	const [owner, name] = repo.name.split("/");

	let sub: string;
	if (repo.error) sub = t(`github.error.${repo.error}`);
	else if (repo.info?.description) sub = repo.info.description;
	else if (repo.latest) sub = `#${repo.latest.number} ${repo.latest.title}`;
	else if (repo.openIssues === 0) sub = t("github.noIssues");
	else sub = "…";

	let badge: string | null = null;
	if (update) badge = t(update.kind === "release" ? "github.badge.release" : "github.badge.push");
	else if (freshIssue) badge = t("github.newIssue");

	return (
		<div className={cn("flex flex-none flex-col rounded-xl transition-colors duration-150", unfolded && "bg-card")}>
			<button
				type="button"
				aria-expanded={unfolded}
				className={cn(
					"flex h-10 flex-none items-center gap-2.5 rounded-xl px-2.5 text-left transition-colors duration-150 hover:bg-card",
					badge && !unfolded && "bg-[rgba(210,153,34,0.1)]",
				)}
				onClick={() => setUnfolded(unfolded ? null : repo.name)}
			>
				<ChevronDownIcon
					size={14}
					className={cn("flex-none text-text-faint transition-transform duration-200", !unfolded && "-rotate-90")}
				/>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-[13px] font-[650]">
						<span className="font-medium text-text-dim">{owner}/</span>
						{name}
					</span>
					<span className={cn("truncate text-[11.5px] text-text-faint", repo.error && "text-danger")}>
						{badge && (
							<span className="mr-1.5 rounded-[4px] bg-[#d29922] px-1.25 text-[10px] font-[750] text-black uppercase">
								{badge}
							</span>
						)}
						{sub}
					</span>
				</div>
				<Stat
					icon={<CircleDotIcon size={12} />}
					tone="text-[#3fb950]"
					value={repo.openIssues}
					title={t("github.stat.issues")}
				/>
				<Stat
					icon={<GitPullRequestIcon size={12} />}
					tone="text-[#a371f7]"
					value={repo.openPrs}
					title={t("github.stat.prs")}
				/>
				<Stat
					icon={<StarIcon size={12} />}
					tone="text-[#e3b341]"
					value={repo.info?.stars}
					title={t("github.stat.stars")}
					big
				/>
			</button>
			<AnimatePresence initial={false}>
				{unfolded && (
					<motion.div
						className="overflow-hidden"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<Details repo={repo} now={now} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

/** A count in the row; `big` ones abbreviate (1.2k) instead of capping at 99+. */
function Stat({
	icon,
	tone,
	value,
	title,
	big,
}: {
	icon: ReactNode;
	tone: string;
	value: number | null | undefined;
	title: string;
	big?: boolean;
}) {
	return (
		<span
			title={title}
			className={cn(
				"flex w-12 flex-none items-center justify-end gap-1 text-[12.5px] font-bold tabular-nums",
				value ? tone : "text-text-faint",
			)}
		>
			{icon}
			{value == null ? "—" : big ? formatStat(value) : formatCount(value)}
		</span>
	);
}

/** The unfolded repo: its numbers, latest release, commit and issue, and links. */
function Details({ repo, now }: { repo: GithubRepo; now: number }) {
	const t = useT();
	const base = `https://github.com/${repo.name}`;
	const ago = (iso: string | null | undefined) => {
		const ms = isoMs(iso);
		return ms ? formatAgo(t, ms, now) : "";
	};
	const info = repo.info;

	return (
		<div
			className="flex flex-col gap-1 px-3 pt-0.5 pb-2.5 pl-8.5 text-[12px]"
			style={{ minHeight: DETAILS_HEIGHT - 6 }}
		>
			{info ? (
				<div className="flex items-center gap-3 text-text-dim">
					<span className="flex items-center gap-1">
						<StarIcon size={12} /> {formatStat(info.stars)}
					</span>
					<span className="flex items-center gap-1">
						<GitForkIcon size={12} /> {formatStat(info.forks)}
					</span>
					{info.language && <span>{info.language}</span>}
					{info.pushedAt && <span className="text-text-faint">{t("github.pushed", { time: ago(info.pushedAt) })}</span>}
				</div>
			) : (
				<div className="text-text-faint">{t("github.detailsPending")}</div>
			)}
			<Line
				icon={<TagIcon size={12} />}
				text={
					repo.release ? (repo.release.name ? `${repo.release.tag} · ${repo.release.name}` : repo.release.tag) : null
				}
				empty={t("github.noRelease")}
				when={ago(repo.release?.publishedAt)}
				url={repo.release?.url}
			/>
			<Line
				icon={<GitCommitHorizontalIcon size={12} />}
				text={repo.commit ? repo.commit.title : null}
				empty="—"
				when={[repo.commit?.author, ago(repo.commit?.date)].filter(Boolean).join(" · ")}
				url={repo.commit?.url}
			/>
			<Line
				icon={<CircleDotIcon size={12} />}
				text={repo.latest ? `#${repo.latest.number} ${repo.latest.title}` : null}
				empty={t("github.noIssues")}
				when={ago(repo.latest?.createdAt)}
				url={repo.latest?.url}
			/>
			<div className="mt-1 flex gap-3.5 text-[11.5px] text-text-dim">
				<LinkButton onClick={() => open(`${base}/issues`)}>{t("github.link.issues")}</LinkButton>
				<LinkButton onClick={() => open(`${base}/pulls`)}>{t("github.link.prs")}</LinkButton>
				<LinkButton onClick={() => open(`${base}/releases`)}>{t("github.link.releases")}</LinkButton>
				<LinkButton onClick={() => open(base)}>{t("github.link.repo")}</LinkButton>
			</div>
		</div>
	);
}

/** One of the latest things: a link when there is one. */
function Line({
	icon,
	text,
	empty,
	when,
	url,
}: {
	icon: ReactNode;
	text: string | null;
	empty: string;
	when: string;
	url: string | undefined;
}) {
	const body = (
		<>
			<span className="flex-none text-text-faint">{icon}</span>
			<span className={cn("min-w-0 flex-1 truncate text-left", text ? "text-text" : "text-text-faint")}>
				{text ?? empty}
			</span>
			{text && when && <span className="flex-none text-[11px] text-text-faint">{when}</span>}
		</>
	);
	if (!text || !url) return <div className="flex h-5.5 items-center gap-2">{body}</div>;
	return (
		<button
			type="button"
			className="flex h-5.5 items-center gap-2 rounded-md hover:underline"
			onClick={() => open(url)}
		>
			{body}
		</button>
	);
}
