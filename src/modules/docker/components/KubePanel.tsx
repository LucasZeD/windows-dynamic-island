import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState } from "react";
import { IconButton } from "../../../components/ui/button";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { formatAgo, useNow } from "../../ai-agents/common/format";
import { setUi, TONE_COLOR, type Tone, useUi } from "../status";
import type { Cluster, LogLine, Pod } from "../types";
import { Field, Grid, Heading, LogView, Message, usePolled } from "./common";

/** How often the pods are read while this view is open. */
const EVERY = 10_000;

function podTone(p: Pod): Tone {
	if (p.phase === "Failed" || p.containers.some((c) => c.reason && /BackOff|Err|OOM/i.test(c.reason))) return "bad";
	if (p.phase === "Succeeded") return "off";
	if (p.phase === "Pending" || p.containers.some((c) => !c.ready)) return "warn";
	return "ok";
}

/** The pods of kubectl's current context, by namespace. */
export function KubePanel() {
	const t = useT();
	const now = useNow(15_000);
	const [round, setRound] = useState(0);
	const { data, error } = usePolled<Cluster>("pods", { round }, EVERY);
	const { unfolded } = useUi();

	let body: ReactNode;
	if (!data) body = <Message text={error ?? t("docker.kube.loading")} />;
	else if (!data.available) body = <Message text={t("docker.kube.missing")} />;
	else if (data.error === "noContext")
		body = <Message text={t("docker.kube.noContext")} hint={t("docker.kube.noContextHint")} />;
	else if (data.error) body = <Message text={t("docker.kube.unreachable")} hint={data.error} />;
	else if (data.pods.length === 0) body = <Message text={t("docker.kube.empty")} />;
	else {
		const namespaces = [...new Set(data.pods.map((p) => p.namespace))].sort();
		body = (
			<div
				className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14"
				data-scroll
			>
				{namespaces.map((ns) => (
					<div key={ns} className="flex flex-none flex-col gap-0.5">
						<div className="px-1.5 pt-1 text-[11.5px] font-bold text-text-dim">{ns}</div>
						{data.pods
							.filter((p) => p.namespace === ns)
							.map((p) => {
								const key = `${p.namespace}/${p.name}`;
								return <PodRow key={key} pod={p} now={now} unfolded={unfolded === key} />;
							})}
					</div>
				))}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1">
			<div className="flex flex-none items-center gap-2 text-[11px] text-text-faint">
				<span className="min-w-0 flex-1 truncate">
					{data?.context ? t("docker.kube.context", { name: data.context }) : ""}
				</span>
				<IconButton size="sm" tone="faint" title={t("docker.refresh")} onClick={() => setRound((r) => r + 1)}>
					<RefreshCwIcon size={13} />
				</IconButton>
			</div>
			{body}
		</div>
	);
}

function PodRow({ pod: p, now, unfolded }: { pod: Pod; now: number; unfolded: boolean }) {
	const t = useT();
	const ready = p.containers.filter((c) => c.ready).length;
	const restarts = p.containers.reduce((n, c) => n + c.restarts, 0);
	const reason = p.containers.find((c) => c.reason)?.reason;
	const tone = podTone(p);
	const key = `${p.namespace}/${p.name}`;

	return (
		<div className={cn("ml-2 flex flex-none flex-col rounded-xl transition-colors", unfolded && "bg-card")}>
			<button
				type="button"
				aria-expanded={unfolded}
				onClick={() => setUi({ unfolded: unfolded ? null : key })}
				className="flex h-10 flex-none items-center gap-2.5 rounded-xl px-2.5 text-left hover:bg-card"
			>
				<ChevronDownIcon
					size={14}
					className={cn("flex-none text-text-faint transition-transform duration-200", !unfolded && "-rotate-90")}
				/>
				<span className="size-2 flex-none rounded-full" style={{ background: TONE_COLOR[tone] }} />
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-[13px] font-[650]">{p.name}</span>
					<span className={cn("truncate text-[11.5px]", tone === "bad" ? "text-danger" : "text-text-faint")}>
						{[reason ?? p.phase, p.owner, p.createdAt ? formatAgo(t, p.createdAt, now) : null]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</div>
				<span className="flex-none text-[12px] font-semibold text-text-dim tabular-nums">
					{ready}/{p.containers.length}
				</span>
				<span
					className={cn(
						"w-14 flex-none text-right text-[11px] tabular-nums",
						restarts ? "text-warn" : "text-text-faint",
					)}
				>
					{t("docker.restarts", { n: restarts })}
				</span>
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
						<PodDetails pod={p} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function PodDetails({ pod: p }: { pod: Pod }) {
	const t = useT();
	const [container, setContainer] = useState(p.containers[0]?.name ?? null);
	const { data, error } = usePolled<LogLine[]>(
		"podLogs",
		{ namespace: p.namespace, pod: p.name, container, tail: 200 },
		4000,
	);

	return (
		<div className="flex h-[260px] flex-col gap-1.5 px-3 pb-2.5 select-text">
			<Grid>
				{p.node && <Field label={t("docker.kube.node")}>{p.node}</Field>}
				{p.ip && (
					<Field label="IP" mono>
						{p.ip}
					</Field>
				)}
			</Grid>
			<Heading>{t("docker.containers")}</Heading>
			<div className="flex flex-wrap gap-1">
				{p.containers.map((c) => (
					<button
						key={c.name}
						type="button"
						onClick={() => setContainer(c.name)}
						title={c.image}
						className={cn(
							"rounded-lg px-2 py-0.5 text-left text-[11px]",
							container === c.name ? "bg-white/14 text-text" : "bg-white/6 text-text-dim hover:bg-white/10",
						)}
					>
						<span className="font-semibold">{c.name}</span>
						<span className="text-text-faint">
							{" "}
							· {c.reason ?? c.state}
							{c.restarts > 0 && ` · ${t("docker.restarts", { n: c.restarts })}`}
						</span>
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1">
				{!data && error ? (
					<div className="text-[11px] text-danger">{error}</div>
				) : (
					<LogView lines={data} empty={t("docker.noLogs")} />
				)}
			</div>
		</div>
	);
}
