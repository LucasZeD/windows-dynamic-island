import type {
	Cluster,
	DockerContainer,
	DockerDetails,
	DockerEvent,
	DockerState,
	LogLine,
} from "../../modules/docker/types";
import { defineMock, provider } from "./kit";

const MIN = 60_000;

const container = (over: Partial<DockerContainer>): DockerContainer => ({
	id: Math.random().toString(16).slice(2, 14).padEnd(12, "0"),
	name: "container",
	image: "alpine:3.20",
	state: "running",
	health: null,
	exitCode: 0,
	oomKilled: false,
	createdAt: Date.now() - 3 * 60 * MIN,
	startedAt: Date.now() - 3 * 60 * MIN,
	finishedAt: 0,
	restartCount: 0,
	project: null,
	service: null,
	ports: [],
	kube: null,
	...over,
});

const containers: DockerContainer[] = [
	container({
		name: "shop-web-1",
		project: "shop",
		service: "web",
		image: "nginx:alpine",
		health: "healthy",
		ports: [{ containerPort: 80, protocol: "tcp", hostIp: "0.0.0.0", hostPort: 8080 }],
	}),
	container({
		name: "shop-api-1",
		project: "shop",
		service: "api",
		image: "shop/api:1.4.2",
		ports: [{ containerPort: 3000, protocol: "tcp", hostIp: "0.0.0.0", hostPort: 3000 }],
	}),
	container({
		name: "shop-db-1",
		project: "shop",
		service: "db",
		image: "postgres:17",
		health: "healthy",
		ports: [{ containerPort: 5432, protocol: "tcp", hostIp: null, hostPort: null }],
	}),
	container({
		name: "blog-worker-1",
		project: "blog",
		service: "worker",
		image: "blog/worker:dev",
		state: "exited",
		exitCode: 1,
		finishedAt: Date.now() - 12 * MIN,
	}),
	container({
		name: "blog-app-1",
		project: "blog",
		service: "app",
		image: "node:22-alpine",
		state: "restarting",
		restartCount: 4,
	}),
	container({ name: "redis", image: "redis:7", state: "exited", exitCode: 0, finishedAt: Date.now() - 2 * 60 * MIN }),
];

const state = provider<DockerState>("docker", {
	available: true,
	running: true,
	ready: true,
	context: "desktop-linux",
	version: "29.9.3",
	containers,
	events: [],
	updatedAt: Date.now(),
	error: null,
});

const details = (id: string): DockerDetails => {
	const c = state.get().containers.find((x) => x.id === id) ?? containers[0];
	return {
		id: `${c.id}${"0".repeat(52)}`,
		command: "/docker-entrypoint.sh nginx -g daemon off;",
		workingDir: "/",
		restartPolicy: "unless-stopped",
		platform: "linux",
		hostname: c.id,
		health: c.health ? { status: c.health, failingStreak: 0, lastOutput: "OK", lastExitCode: 0 } : null,
		error: null,
		mounts: [
			{
				kind: "volume",
				name: `${c.project}_data`,
				source: null,
				destination: "/data",
				readOnly: false,
				driver: "local",
			},
			{
				kind: "bind",
				name: null,
				source: "C:\\Users\\me\\shop\\nginx.conf",
				destination: "/etc/nginx/nginx.conf",
				readOnly: true,
				driver: null,
			},
		],
		networks: [
			{ name: `${c.project}_default`, ip: "172.18.0.2", gateway: "172.18.0.1", aliases: [c.service ?? c.name] },
		],
		compose: c.project
			? {
					project: c.project,
					service: c.service,
					workingDir: `C:\\Users\\me\\${c.project}`,
					configFiles: [`C:\\Users\\me\\${c.project}\\compose.yaml`],
					number: "1",
				}
			: null,
		kube: {},
		labels: { "org.opencontainers.image.source": "https://github.com/nginx/docker-nginx" },
		image: {
			id: "sha256:fed7e14be83cbd2661a75cdc5b872d936cf155d46c327084d30b8df19ae88d72",
			tags: [c.image],
			digests: [`${c.image.split(":")[0]}@sha256:fed7e14be83cbd26`],
			createdAt: Date.now() - 12 * 24 * 60 * MIN,
			size: 93_626_761,
			platform: "linux/amd64",
			layers: 8,
			labels: { maintainer: "NGINX Docker Maintainers" },
			history: [
				{ createdBy: 'CMD ["nginx" "-g" "daemon off;"]', size: "0B", created: "2 weeks ago" },
				{ createdBy: "EXPOSE map[80/tcp:{}]", size: "0B", created: "2 weeks ago" },
				{ createdBy: "COPY docker-entrypoint.sh / # buildkit", size: "1.62kB", created: "2 weeks ago" },
				{
					createdBy: "RUN /bin/sh -c set -x && apk add --no-cache nginx # buildkit",
					size: "58.1MB",
					created: "2 weeks ago",
				},
				{
					createdBy: "ADD alpine-minirootfs-3.22.2-x86_64.tar.gz / # buildkit",
					size: "8.32MB",
					created: "3 weeks ago",
				},
			],
		},
	};
};

const logs = (): LogLine[] =>
	Array.from({ length: 40 }, (_, i) => ({
		at: new Date(Date.now() - (40 - i) * 1000).toISOString(),
		err: i % 9 === 8,
		text: i % 9 === 8 ? `warn: slow upstream (${200 + i} ms)` : `GET /api/items?page=${i} 200 ${12 + (i % 7)}ms`,
	}));

const cluster: Cluster = {
	available: true,
	context: "docker-desktop",
	error: null,
	pods: [
		{
			namespace: "shop",
			name: "api-7d9f8b-x2k4p",
			phase: "Running",
			node: "docker-desktop",
			ip: "10.1.0.5",
			createdAt: Date.now() - 50 * MIN,
			owner: "Deployment/api",
			containers: [
				{
					name: "api",
					image: "shop/api:1.4.2",
					ready: false,
					restarts: 7,
					state: "waiting",
					reason: "CrashLoopBackOff",
				},
				{ name: "envoy", image: "envoyproxy/envoy:v1.32", ready: true, restarts: 0, state: "running", reason: null },
			],
		},
		{
			namespace: "kube-system",
			name: "coredns-668d6bf9bc-9xk2c",
			phase: "Running",
			node: "docker-desktop",
			ip: "10.1.0.2",
			createdAt: Date.now() - 3 * 24 * 60 * MIN,
			owner: "Deployment/coredns",
			containers: [
				{
					name: "coredns",
					image: "registry.k8s.io/coredns:v1.11",
					ready: true,
					restarts: 0,
					state: "running",
					reason: null,
				},
			],
		},
	],
};

function crash() {
	const at = Date.now();
	state.set((s) => {
		const [first, ...rest] = s.containers;
		const crashed = { ...first, state: "exited", exitCode: 2, finishedAt: at, health: null };
		const event: DockerEvent = {
			key: `${first.id}:crashed:${at}`,
			kind: "crashed",
			container: crashed.name,
			id: first.id,
			exitCode: 2,
			at,
		};
		return { ...s, containers: [crashed, ...rest], events: [event, ...s.events] };
	});
}

const setState = (id: string, next: string) =>
	state.set((s) => ({
		...s,
		containers: s.containers.map((c) =>
			c.id === id
				? {
						...c,
						state: next,
						startedAt: next === "running" ? Date.now() : c.startedAt,
						exitCode: 0,
						finishedAt: next === "exited" ? Date.now() : c.finishedAt,
					}
				: c,
		),
	}));

const byId = (handler: (id: string) => unknown) => (payload: unknown) => handler((payload as { id: string }).id);

export const docker = defineMock({
	label: "Docker",
	start: () => state.publish(),
	controls: [
		{ kind: "button", label: "Crash a container", run: crash },
		{
			kind: "toggle",
			label: "Daemon running",
			value: () => state.get().running,
			set: (running) =>
				state.set((s) => ({ ...s, running, error: running ? null : "Cannot connect to the Docker daemon" })),
		},
	],
	actions: {
		docker: {
			poll: () => null,
			details: byId(details),
			stats: () => ({
				cpu: `${(Math.random() * 8).toFixed(2)}%`,
				memory: "24.8MiB / 15.46GiB",
				memoryPercent: "0.16%",
				net: "1.88kB / 126B",
				block: "6.93MB / 12.3kB",
				pids: "29",
			}),
			logs,
			podLogs: logs,
			pods: () => cluster,
			start: byId((id) => setState(id, "running")),
			unpause: byId((id) => setState(id, "running")),
			restart: byId((id) => setState(id, "running")),
			stop: byId((id) => setState(id, "exited")),
			pause: byId((id) => setState(id, "paused")),
			open: () => null,
		},
	},
});
