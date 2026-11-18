import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { providerAction } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { type MessageKey, useT } from "../../../core/i18n";
import { formatAgo } from "../../ai-agents/common/format";
import { bytes, DETAILS_HEIGHT } from "../status";
import {
	DOCKER_PROVIDER,
	type DockerContainer,
	type DockerDetails,
	type DockerPort,
	type DockerStats,
	type LogLine,
} from "../types";
import { Empty, Field, Grid, Heading, LogView, usePolled } from "./common";

type Tab = "overview" | "image" | "volumes" | "network" | "kube" | "logs";
const TABS: Tab[] = ["overview", "image", "volumes", "network", "kube", "logs"];

/** The unfolded container: everything Docker knows about it, by topic. */
export function ContainerDetails({ container }: { container: DockerContainer }) {
	const t = useT();
	const [tab, setTab] = useState<Tab>("overview");
	// Inspected again when its state changes (a restart moves mounts, networks, health).
	const { data, error } = usePolled<DockerDetails>("details", { id: container.id, s: container.state }, 0);
	const tabs = TABS.filter((x) => x !== "kube" || container.kube || Object.keys(data?.kube ?? {}).length > 0);

	return (
		<div className="flex flex-col px-2.5 pb-2.5" style={{ height: DETAILS_HEIGHT - 4 }}>
			<div className="flex flex-none gap-1 pb-2" role="tablist">
				{tabs.map((x) => (
					<button
						key={x}
						type="button"
						role="tab"
						aria-selected={tab === x}
						onClick={() => setTab(x)}
						className={cn(
							"rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors",
							tab === x ? "bg-white/14 text-text" : "text-text-faint hover:bg-white/8 hover:text-text-dim",
						)}
					>
						{t(`docker.tab.${x}` as MessageKey)}
					</button>
				))}
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto pr-1 select-text [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14"
				data-scroll
			>
				{tab === "logs" ? (
					<Logs id={container.id} />
				) : !data ? (
					<Empty text={error ?? t("docker.loading")} />
				) : tab === "overview" ? (
					<Overview c={container} d={data} />
				) : tab === "image" ? (
					<Image d={data} />
				) : tab === "volumes" ? (
					<Volumes d={data} />
				) : tab === "network" ? (
					<Network c={container} d={data} />
				) : (
					<Kube c={container} d={data} />
				)}
			</div>
		</div>
	);
}

export function PortLink({ port }: { port: DockerPort }) {
	const label = port.hostPort
		? `${port.hostPort}→${port.containerPort}/${port.protocol}`
		: `${port.containerPort}/${port.protocol}`;
	if (!port.hostPort || port.protocol !== "tcp") return <span className="text-text-dim">{label}</span>;
	return (
		<button
			type="button"
			className="flex items-center gap-1 text-[#58a6ff] hover:underline"
			onClick={() => providerAction(DOCKER_PROVIDER, "open", { port: port.hostPort })}
		>
			{label}
			<ExternalLinkIcon size={11} />
		</button>
	);
}

function Overview({ c, d }: { c: DockerContainer; d: DockerDetails }) {
	const t = useT();
	const running = c.state === "running";
	const { data: stats } = usePolled<DockerStats>("stats", { id: c.id }, 4000, running);

	return (
		<>
			{running && (
				<>
					<Heading>{t("docker.usage")}</Heading>
					<div className="grid grid-cols-5 gap-1.5">
						<Stat label="CPU" value={stats?.cpu} />
						<Stat label={t("docker.memory")} value={stats?.memoryPercent} sub={stats?.memory.split(" / ")[0]} />
						<Stat label={t("docker.net")} value={stats?.net} small />
						<Stat label={t("docker.disk")} value={stats?.block} small />
						<Stat label="PIDs" value={stats?.pids} />
					</div>
				</>
			)}
			<Heading>{t("docker.container")}</Heading>
			<Grid>
				<Field label="ID" mono>
					{d.id.slice(0, 12)}
				</Field>
				<Field label={t("docker.image")}>{c.image}</Field>
				<Field label={t("docker.command")} mono>
					{d.command || "—"}
				</Field>
				{c.ports.length > 0 && (
					<Field label={t("docker.ports")}>
						<span className="flex flex-wrap gap-x-3">
							{c.ports.map((p) => (
								<PortLink key={`${p.containerPort}/${p.protocol}:${p.hostPort}`} port={p} />
							))}
						</span>
					</Field>
				)}
				<Field label={t("docker.created")}>{formatAgo(t, c.createdAt)}</Field>
				<Field label={t("docker.restartPolicy")}>
					{d.restartPolicy}
					{c.restartCount > 0 && ` · ${t("docker.restarts", { n: c.restartCount })}`}
				</Field>
				{c.state === "exited" && (
					<Field label={t("docker.exitCode")}>
						{c.exitCode}
						{c.oomKilled && ` · ${t("docker.oom")}`}
					</Field>
				)}
				{d.error && <Field label={t("docker.error")}>{d.error}</Field>}
			</Grid>
			{d.health && (
				<>
					<Heading>{t("docker.healthCheck")}</Heading>
					<Grid>
						<Field label={t("docker.status")}>
							{d.health.status}
							{d.health.failingStreak > 0 && ` · ${t("docker.failing", { n: d.health.failingStreak })}`}
						</Field>
						{d.health.lastOutput && (
							<Field label={t("docker.lastCheck")} mono>
								{d.health.lastOutput}
							</Field>
						)}
					</Grid>
				</>
			)}
			{d.compose && (
				<>
					<Heading>{t("docker.compose")}</Heading>
					<Grid>
						<Field label={t("docker.project")}>{d.compose.project}</Field>
						{d.compose.service && <Field label={t("docker.service")}>{d.compose.service}</Field>}
						{d.compose.workingDir && (
							<Field label={t("docker.folder")} mono>
								{d.compose.workingDir}
							</Field>
						)}
						{d.compose.configFiles.length > 0 && (
							<Field label={t("docker.files")} mono>
								{d.compose.configFiles.join("\n")}
							</Field>
						)}
					</Grid>
				</>
			)}
			<Labels labels={d.labels} />
		</>
	);
}

function Stat({ label, value, sub, small }: { label: string; value?: string; sub?: string; small?: boolean }) {
	return (
		<div className="flex min-w-0 flex-col rounded-lg bg-white/6 px-2 py-1">
			<span className="text-[10px] text-text-faint">{label}</span>
			<span className={cn("truncate font-semibold tabular-nums", small ? "text-[11px]" : "text-[13px]")}>
				{value ?? "…"}
			</span>
			{sub && <span className="truncate text-[10px] text-text-faint">{sub}</span>}
		</div>
	);
}

function Labels({ labels }: { labels: Record<string, string> }) {
	const t = useT();
	const entries = Object.entries(labels);
	if (entries.length === 0) return null;
	return (
		<>
			<Heading>{t("docker.labels")}</Heading>
			<Grid>
				{entries.map(([k, v]) => (
					<Field key={k} label={k.split(".").pop() ?? k} mono>
						<span title={k}>{v}</span>
					</Field>
				))}
			</Grid>
		</>
	);
}

function Image({ d }: { d: DockerDetails }) {
	const t = useT();
	const img = d.image;
	if (!img) return <Empty text={t("docker.noImage")} />;
	return (
		<>
			<Grid>
				<Field label={t("docker.tags")}>{img.tags.join(", ") || "—"}</Field>
				<Field label="ID" mono>
					{img.id.replace("sha256:", "").slice(0, 12)}
				</Field>
				<Field label={t("docker.built")}>{img.createdAt ? formatAgo(t, img.createdAt) : "—"}</Field>
				<Field label={t("docker.size")}>
					{bytes(img.size)} · {t("docker.layers", { n: img.layers })}
				</Field>
				<Field label={t("docker.platform")}>{img.platform || "—"}</Field>
				{img.digests[0] && (
					<Field label={t("docker.digest")} mono>
						{img.digests[0]}
					</Field>
				)}
			</Grid>
			<Labels labels={img.labels} />
			<Heading>{t("docker.build")}</Heading>
			{img.history.length === 0 ? (
				<Empty text={t("docker.noBuild")} />
			) : (
				<ol className="flex flex-col gap-0.5">
					{img.history.map((step, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: build steps are fixed for an image
						<li key={i} className="flex gap-2 rounded-md px-1 py-0.5 text-[11px] hover:bg-white/5">
							<span className="w-5 flex-none text-right text-text-faint tabular-nums">{img.history.length - i}</span>
							<span className="min-w-0 flex-1 font-mono break-all text-text-dim">{step.createdBy}</span>
							<span className="flex-none text-text-faint tabular-nums">{step.size}</span>
						</li>
					))}
				</ol>
			)}
		</>
	);
}

function Volumes({ d }: { d: DockerDetails }) {
	const t = useT();
	if (d.mounts.length === 0) return <Empty text={t("docker.noMounts")} />;
	return (
		<div className="flex flex-col gap-1.5">
			{d.mounts.map((m) => (
				<div key={m.destination} className="rounded-lg bg-white/6 px-2.5 py-1.5 text-[11.5px]">
					<div className="flex items-center gap-2">
						<span className="rounded-[4px] bg-white/10 px-1.25 text-[10px] font-bold text-text-dim uppercase">
							{m.kind}
						</span>
						<span className="min-w-0 flex-1 truncate font-mono font-semibold">{m.destination}</span>
						<span className={cn("text-[10.5px]", m.readOnly ? "text-warn" : "text-text-faint")}>
							{m.readOnly ? t("docker.readOnly") : t("docker.readWrite")}
						</span>
					</div>
					<div className="mt-0.5 font-mono text-[10.5px] break-all text-text-faint">
						{m.name && m.kind === "volume" ? `${m.name}${m.driver ? ` (${m.driver})` : ""}` : (m.source ?? "—")}
					</div>
				</div>
			))}
		</div>
	);
}

function Network({ c, d }: { c: DockerContainer; d: DockerDetails }) {
	const t = useT();
	return (
		<>
			<Heading>{t("docker.ports")}</Heading>
			{c.ports.length === 0 ? (
				<div className="text-[11.5px] text-text-faint">{t("docker.noPorts")}</div>
			) : (
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
					{c.ports.map((p) => (
						<PortLink key={`${p.containerPort}/${p.protocol}:${p.hostPort}`} port={p} />
					))}
				</div>
			)}
			{d.networks.map((n) => (
				<div key={n.name}>
					<Heading>{n.name}</Heading>
					<Grid>
						<Field label="IP" mono>
							{n.ip ?? "—"}
						</Field>
						{n.gateway && (
							<Field label={t("docker.gateway")} mono>
								{n.gateway}
							</Field>
						)}
						{n.aliases.length > 0 && <Field label={t("docker.aliases")}>{n.aliases.join(", ")}</Field>}
					</Grid>
				</div>
			))}
			{d.hostname && (
				<>
					<Heading>{t("docker.hostname")}</Heading>
					<div className="font-mono text-[11px] text-text-dim">{d.hostname}</div>
				</>
			)}
		</>
	);
}

function Kube({ c, d }: { c: DockerContainer; d: DockerDetails }) {
	const t = useT();
	const entries = Object.entries(d.kube);
	return (
		<>
			{c.kube && (
				<Grid>
					<Field label={t("docker.pod")}>{c.kube.pod}</Field>
					{c.kube.namespace && <Field label={t("docker.namespace")}>{c.kube.namespace}</Field>}
					{c.kube.container && <Field label={t("docker.container")}>{c.kube.container}</Field>}
				</Grid>
			)}
			{entries.length > 0 && (
				<>
					<Heading>{t("docker.labels")}</Heading>
					<Grid>
						{entries.map(([k, v]) => (
							<Field key={k} label={k.replace("io.kubernetes.", "")} mono>
								{v}
							</Field>
						))}
					</Grid>
				</>
			)}
		</>
	);
}

function Logs({ id }: { id: string }) {
	const t = useT();
	const { data, error } = usePolled<LogLine[]>("logs", { id, tail: 300 }, 2500);
	if (!data && error) return <Empty text={error} />;
	return <LogView lines={data} empty={t("docker.noLogs")} />;
}
