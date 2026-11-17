import { CircleDotIcon, GripVerticalIcon, XIcon } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { type FormEvent, useState } from "react";
import { Button, IconButton, LinkButton } from "../../../components/ui/button";
import { Block, Desc, Divider, Row } from "../../../components/ui/card";
import { Input, Select } from "../../../components/ui/form";
import { providerAction, useProvider } from "../../../core/bridge";
import { useT } from "../../../core/i18n";
import { setSetting, useSetting } from "../../../core/settings";
import { formatCount, parseRepo } from "../repo";
import { githubBranches, githubRepos } from "../settings";
import type { GithubRepo, GithubState } from "../types";

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo&description=Dynamic%20Island";

/** Followed repositories + GitHub account, for the settings window. */
export function GithubSettings() {
	return (
		<>
			<Repos />
			<Divider className="mb-1" />
			<Account />
		</>
	);
}

function Repos() {
	const t = useT();
	const state = useProvider<GithubState>("github");
	const repos = useSetting(githubRepos);
	const branches = useSetting(githubBranches);
	const [input, setInput] = useState("");
	const [error, setError] = useState<string | null>(null);

	const add = (e: FormEvent) => {
		e.preventDefault();
		const name = parseRepo(input);
		if (!name) return setError(t("github.repos.invalid"));
		if (repos.some((r) => r.toLowerCase() === name.toLowerCase())) return setError(t("github.repos.duplicate"));
		setSetting(githubRepos, [...repos, name]);
		setInput("");
		setError(null);
	};

	return (
		<Block>
			<Row label={t("github.repos.title")} desc={t("github.repos.desc")} />
			<form className="flex gap-2" onSubmit={add}>
				<Input
					className="flex-1"
					value={input}
					placeholder={t("github.repos.placeholder")}
					spellCheck={false}
					onChange={(e) => {
						setInput(e.target.value);
						setError(null);
					}}
				/>
				<Button type="submit" variant="primary" disabled={!input.trim()}>
					{t("github.repos.add")}
				</Button>
			</form>
			{error && <Desc tone="error">{error}</Desc>}
			{repos.length > 0 && (
				<Reorder.Group
					as="ul"
					axis="y"
					className="mt-0.5 flex list-none flex-col gap-1"
					values={repos}
					onReorder={(order: string[]) => setSetting(githubRepos, order)}
				>
					{repos.map((name) => (
						<RepoItem
							key={name}
							name={name}
							repo={state?.repos.find((r) => r.name.toLowerCase() === name.toLowerCase())}
							branch={branches[name] ?? ""}
							onBranch={(branch) => setSetting(githubBranches, withBranch(branches, name, branch))}
							onRemove={() => {
								setSetting(
									githubRepos,
									repos.filter((r) => r !== name),
								);
								setSetting(githubBranches, withBranch(branches, name, ""));
							}}
						/>
					))}
				</Reorder.Group>
			)}
		</Block>
	);
}

/** A followed repo: drag the grip to reorder (the island lists them in this order). */
function RepoItem({
	name,
	repo,
	branch,
	onBranch,
	onRemove,
}: {
	name: string;
	repo: GithubRepo | undefined;
	branch: string;
	onBranch: (branch: string) => void;
	onRemove: () => void;
}) {
	const t = useT();
	const drag = useDragControls();
	return (
		<Reorder.Item
			as="li"
			value={name}
			dragListener={false}
			dragControls={drag}
			className="relative flex min-h-8.5 items-center gap-2 rounded-[9px] bg-white/4 pr-1.5 pl-1"
			whileDrag={{ scale: 1.02, boxShadow: "0 10px 24px -10px rgba(0,0,0,0.6)" }}
		>
			<span
				className="grid h-7 w-5 flex-none cursor-grab touch-none place-items-center text-text-faint active:cursor-grabbing"
				title={t("layout.drag")}
				onPointerDown={(e) => drag.start(e)}
			>
				<GripVerticalIcon size={14} />
			</span>
			<span className="min-w-0 flex-1 truncate text-[13px] font-[550]">{name}</span>
			{repo?.error ? (
				<span className="flex items-center gap-1 text-[12px] font-medium text-danger">
					{t(`github.error.${repo.error}`)}
				</span>
			) : (
				repo?.openIssues != null && (
					<span className="flex items-center gap-1 text-[12px] font-[650] text-[#3fb950]">
						<CircleDotIcon size={12} />
						{formatCount(repo.openIssues)}
					</span>
				)
			)}
			<BranchSelect repo={name} value={branch} defaultBranch={repo?.info?.defaultBranch ?? null} onChange={onBranch} />
			<IconButton size="sm" tone="danger" title={t("github.repos.remove")} onClick={onRemove}>
				<XIcon size={12} />
			</IconButton>
		</Reorder.Item>
	);
}

/** `branches` with `repo` following `branch` ("" for the default one). */
function withBranch(branches: Record<string, string>, repo: string, branch: string) {
	const next = { ...branches };
	if (branch) next[repo] = branch;
	else delete next[repo];
	return next;
}

/**
 * The branch a repo follows for commits. The list comes from GitHub when the
 * pointer gets near (one call per repo, only for the repos looked at).
 */
function BranchSelect({
	repo,
	value,
	defaultBranch,
	onChange,
}: {
	repo: string;
	value: string;
	defaultBranch: string | null;
	onChange: (branch: string) => void;
}) {
	const t = useT();
	const [names, setNames] = useState<string[] | null>(null);
	const [loading, setLoading] = useState(false);
	const load = () => {
		if (names || loading) return;
		setLoading(true);
		providerAction("github", "branches", { repo })
			.then((list) => setNames(Array.isArray(list) ? (list as string[]) : []))
			.catch(() => setNames([]))
			.finally(() => setLoading(false));
	};
	// The chosen branch stays listed even before (or without) GitHub's list.
	const options = [...new Set([...(names ?? []), ...(value ? [value] : [])])].filter((b) => b !== defaultBranch);

	return (
		<Select
			size="sm"
			className="max-w-36"
			value={value}
			title={t("github.branch.label")}
			onPointerEnter={load}
			onFocus={load}
			onChange={(e) => onChange(e.target.value)}
		>
			<option value="">
				{defaultBranch ? t("github.branch.defaultNamed", { name: defaultBranch }) : t("github.branch.default")}
			</option>
			{options.map((b) => (
				<option key={b} value={b}>
					{b}
				</option>
			))}
			{loading && (
				<option value="" disabled>
					{t("github.branch.loading")}
				</option>
			)}
		</Select>
	);
}

function Account() {
	const t = useT();
	const state = useProvider<GithubState>("github");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async (action: "setToken" | "clearToken", payload?: unknown) => {
		setBusy(true);
		setError(null);
		try {
			await providerAction("github", action, payload);
			setToken("");
		} catch (e) {
			const code = String(e);
			setError(code === "unauthorized" ? t("github.error.unauthorized") : code);
		} finally {
			setBusy(false);
		}
	};

	const login = state?.login ?? "…";
	const status = state?.authError
		? t("github.account.rejected")
		: state?.auth === "token"
			? t("github.account.token", { login })
			: state?.auth === "gh"
				? t("github.account.gh", { login })
				: t("github.account.none");

	return (
		<Block>
			<Row label={t("github.account.title")} desc={status} descTone={state?.authError ? "warn" : undefined}>
				{state?.auth === "token" && (
					<Button variant="danger" disabled={busy} onClick={() => run("clearToken")}>
						{busy ? "…" : t("github.account.remove")}
					</Button>
				)}
			</Row>
			{state?.auth !== "token" && (
				<>
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							run("setToken", { token });
						}}
					>
						<Input
							className="flex-1"
							type="password"
							value={token}
							placeholder={t("github.account.placeholder")}
							autoComplete="off"
							spellCheck={false}
							onChange={(e) => setToken(e.target.value)}
						/>
						<Button type="submit" variant="primary" disabled={busy || !token.trim()}>
							{busy ? "…" : t("github.account.save")}
						</Button>
					</form>
					<Desc>
						{t("github.account.stored")}{" "}
						<LinkButton onClick={() => providerAction("github", "open", { url: TOKEN_URL })}>
							{t("github.account.create")}
						</LinkButton>
					</Desc>
				</>
			)}
			{error && <Desc tone="error">{error}</Desc>}
		</Block>
	);
}
