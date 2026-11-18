import {
	ChevronDownIcon,
	FolderIcon,
	LoaderCircleIcon,
	PauseIcon,
	PlayIcon,
	RefreshCwIcon,
	RotateCwIcon,
	SquareIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { IconButton } from "../../../components/ui/button";
import { providerAction } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { useSetting } from "../../../core/settings";
import { formatAgo, useNow } from "../../ai-agents/common/format";
import { dockerSettings } from "../settings";
import { displayName, groups, isUp, setUi, span, TONE_COLOR, toneOf, useUi, type View } from "../status";
import { DOCKER_PROVIDER, type DockerContainer, type DockerState } from "../types";
import { ContainerDetails, PortLink } from "./ContainerDetails";
import { Message } from "./common";
import { KubePanel } from "./KubePanel";

const scrollbar =
	"[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14";

/** Expanded panel: the containers by Compose project, or the Kubernetes cluster's pods. */
export function DockerPanel({ state }: { state: DockerState | undefined }) {
	const t = useT();
	const { view } = useUi();

	// Opening the tab reads the list now instead of at the next poll.
	useEffect(() => {
		providerAction(DOCKER_PROVIDER, "poll");
	}, []);

	return (
		<div className="flex h-full flex-col gap-2">
			<div className="flex h-6 flex-none items-center gap-2">
				<Switch view={view} />
				<span className="min-w-0 flex-1 truncate text-right text-[11px] text-text-faint">
					{view === "containers" && <Summary state={state} />}
				</span>
				{view === "containers" && (
					<IconButton
						size="sm"
						tone="faint"
						title={t("docker.refresh")}
						onClick={() => providerAction(DOCKER_PROVIDER, "poll")}
					>
						<RefreshCwIcon size={14} />
					</IconButton>
				)}
			</div>
			{view === "kube" ? <KubePanel /> : <Containers state={state} />}
		</div>
	);
}

function Switch({ view }: { view: View }) {
	const t = useT();
	const item = (v: View, label: string) => (
		<button
			type="button"
			aria-pressed={view === v}
			onClick={() => setUi({ view: v, unfolded: null })}
			className={cn(
				"rounded-full px-2.5 py-0.5 text-[12px] font-semibold transition-colors",
				view === v ? "bg-white/14 text-text" : "text-text-faint hover:text-text-dim",
			)}
		>
			{label}
		</button>
	);
	return (
		<div className="flex flex-none gap-0.5 rounded-full bg-white/6 p-0.5">
			{item("containers", t("docker.containers"))}
			{item("kube", t("docker.kubernetes"))}
		</div>
	);
}

function Summary({ state }: { state: DockerState | undefined }) {
	const t = useT();
	if (!state?.running) return null;
	const up = state.containers.filter((c) => c.state === "running").length;
	const parts = [t("docker.summary", { up, total: state.containers.length })];
	if (state.context) parts.push(state.context);
	if (state.version) parts.push(`v${state.version}`);
	return <>{parts.join(" · ")}</>;
}

function Containers({ state }: { state: DockerState | undefined }) {
	const t = useT();
	const now = useNow(15_000);
	const showStopped = useSetting(dockerSettings.showStopped);
	const { unfolded } = useUi();

	if (!state?.ready) return <Message text={t("docker.loading")} />;
	if (!state.available) return <Message text={t("docker.missing")} hint={t("docker.missingHint")} />;
	if (!state.running) return <Message text={t("docker.down")} hint={state.error ?? undefined} />;

	const list = groups(state.containers, showStopped);
	if (list.length === 0)
		return (
			<Message
				text={t(state.containers.length ? "docker.noneRunning" : "docker.empty")}
				hint={state.containers.length ? t("docker.noneRunningHint") : undefined}
			/>
		);
	const headers = list.some((g) => g.project);

	return (
		// data-scroll: the wheel scrolls the list instead of switching tabs.
		<div className={cn("flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1", scrollbar)} data-scroll>
			{list.map((g) => (
				<div key={g.project ?? ""} className="flex flex-none flex-col gap-0.5">
					{headers && <GroupHeader project={g.project} containers={g.containers} />}
					{g.containers.map((c) => (
						<Row key={c.id} c={c} now={now} unfolded={unfolded === c.id} indent={headers} />
					))}
				</div>
			))}
		</div>
	);
}

function GroupHeader({ project, containers }: { project: string | null; containers: DockerContainer[] }) {
	const t = useT();
	const up = containers.filter((c) => c.state === "running").length;
	const bad = containers.some((c) => toneOf(c) === "bad");
	return (
		<div className="flex h-6.5 flex-none items-center gap-1.5 px-1.5 text-[11.5px]">
			<FolderIcon size={12} className="text-text-faint" />
			<span className="font-bold text-text-dim">{project ?? t("docker.standalone")}</span>
			<span className={cn("tabular-nums", bad ? "text-danger" : "text-text-faint")}>
				{up}/{containers.length}
			</span>
		</div>
	);
}

/** "Up 3 h · healthy", "Exited (1) 5 min ago", "Restarting (4)". */
function statusText(c: DockerContainer, now: number, t: ReturnType<typeof useT>): string {
	switch (c.state) {
		case "running": {
			const up = t("docker.up", { time: span(now - c.startedAt) });
			return c.health ? `${up} · ${t(`docker.healthState.${c.health}` as "docker.healthState.healthy")}` : up;
		}
		case "exited":
		case "dead": {
			const exited = t("docker.exited", { code: c.exitCode });
			const oom = c.oomKilled ? ` · ${t("docker.oom")}` : "";
			return c.finishedAt ? `${exited} ${formatAgo(t, c.finishedAt, now)}${oom}` : exited + oom;
		}
		case "restarting":
			return t("docker.restarting", { n: c.restartCount });
		case "paused":
			return t("docker.paused");
		case "created":
			return t("docker.createdState");
		default:
			return c.state;
	}
}

function Row({ c, now, unfolded, indent }: { c: DockerContainer; now: number; unfolded: boolean; indent: boolean }) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const tone = toneOf(c);
	const up = isUp(c);
	const name = displayName(c);
	const published = c.ports.find((p) => p.hostPort && p.protocol === "tcp");

	const run = (action: string) => {
		setBusy(true);
		setError(null);
		providerAction(DOCKER_PROVIDER, action, { id: c.id })
			.catch((e) => setError(String(e)))
			.finally(() => setBusy(false));
	};

	return (
		<div
			className={cn(
				"group flex flex-none flex-col rounded-xl transition-colors duration-150",
				unfolded && "bg-card",
				indent && "ml-2",
			)}
		>
			<div className="flex h-10 flex-none items-center gap-1 rounded-xl pr-1.5 transition-colors duration-150 hover:bg-card">
				<button
					type="button"
					aria-expanded={unfolded}
					className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2.5 text-left"
					onClick={() => setUi({ unfolded: unfolded ? null : c.id })}
				>
					<ChevronDownIcon
						size={14}
						className={cn("flex-none text-text-faint transition-transform duration-200", !unfolded && "-rotate-90")}
					/>
					<span
						className={cn("size-2 flex-none rounded-full", c.state === "restarting" && "animate-pulse")}
						style={{ background: TONE_COLOR[tone] }}
					/>
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="flex min-w-0 items-baseline gap-1.5">
							<span className={cn("truncate text-[13px] font-[650]", !up && "text-text-dim")}>{name}</span>
							<span className="truncate text-[11px] text-text-faint">{c.image}</span>
						</span>
						<span
							className={cn("truncate text-[11.5px]", error || tone === "bad" ? "text-danger" : "text-text-faint")}
							title={error ?? undefined}
						>
							{error ?? statusText(c, now, t)}
						</span>
					</div>
				</button>
				{published && (
					<span className="flex-none text-[11px]">
						<PortLink port={published} />
					</span>
				)}
				<div className="flex flex-none items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
					{busy ? (
						<span className="grid size-6 place-items-center text-text-faint">
							<LoaderCircleIcon size={14} className="animate-spin" />
						</span>
					) : c.state === "paused" ? (
						<IconButton size="sm" tone="dim" title={t("docker.unpause")} onClick={() => run("unpause")}>
							<PlayIcon size={13} />
						</IconButton>
					) : up ? (
						<>
							<IconButton size="sm" tone="dim" title={t("docker.pause")} onClick={() => run("pause")}>
								<PauseIcon size={13} />
							</IconButton>
							<IconButton size="sm" tone="dim" title={t("docker.restart")} onClick={() => run("restart")}>
								<RotateCwIcon size={13} />
							</IconButton>
							<IconButton size="sm" tone="danger" title={t("docker.stop")} onClick={() => run("stop")}>
								<SquareIcon size={12} />
							</IconButton>
						</>
					) : (
						<IconButton size="sm" tone="dim" title={t("docker.start")} onClick={() => run("start")}>
							<PlayIcon size={13} />
						</IconButton>
					)}
				</div>
			</div>
			<AnimatePresence initial={false}>
				{unfolded && (
					<motion.div
						className="overflow-hidden"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
					>
						<ContainerDetails container={c} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
