/** Mirrors `src-tauri/src/providers/docker/` (`DockerState`, `model.rs`, `kube.rs`). */

export const DOCKER_PROVIDER = "docker";
/** Docker's blue. */
export const DOCKER_ACCENT = "#2496ED";

export interface DockerPort {
	containerPort: number;
	protocol: string;
	hostIp: string | null;
	hostPort: number | null;
}

export interface DockerContainer {
	/** Short id (12 characters). */
	id: string;
	name: string;
	image: string;
	/** created / running / paused / restarting / removing / exited / dead */
	state: string;
	/** starting / healthy / unhealthy, with a health check. */
	health: string | null;
	exitCode: number;
	oomKilled: boolean;
	/** Unix ms; 0 when never. */
	createdAt: number;
	startedAt: number;
	finishedAt: number;
	restartCount: number;
	project: string | null;
	service: string | null;
	ports: DockerPort[];
	kube: { pod: string; namespace: string | null; container: string | null } | null;
}

export interface DockerEvent {
	key: string;
	kind: "crashed" | "oom" | "unhealthy";
	container: string;
	id: string;
	exitCode: number;
	at: number;
}

export interface DockerState {
	available: boolean;
	running: boolean;
	ready: boolean;
	context: string | null;
	version: string | null;
	containers: DockerContainer[];
	/** Newest first. */
	events: DockerEvent[];
	updatedAt: number;
	error: string | null;
}

export interface DockerMount {
	kind: string;
	name: string | null;
	source: string | null;
	destination: string;
	readOnly: boolean;
	driver: string | null;
}

export interface DockerImage {
	id: string;
	tags: string[];
	digests: string[];
	createdAt: number;
	size: number;
	platform: string;
	layers: number;
	labels: Record<string, string>;
	history: { createdBy: string; size: string; created: string }[];
}

export interface DockerDetails {
	id: string;
	command: string;
	workingDir: string | null;
	restartPolicy: string;
	platform: string | null;
	hostname: string | null;
	health: { status: string; failingStreak: number; lastOutput: string | null; lastExitCode: number | null } | null;
	error: string | null;
	mounts: DockerMount[];
	networks: { name: string; ip: string | null; gateway: string | null; aliases: string[] }[];
	compose: {
		project: string;
		service: string | null;
		workingDir: string | null;
		configFiles: string[];
		number: string | null;
	} | null;
	kube: Record<string, string>;
	labels: Record<string, string>;
	image: DockerImage | null;
}

export interface DockerStats {
	cpu: string;
	memory: string;
	memoryPercent: string;
	net: string;
	block: string;
	pids: string;
}

export interface LogLine {
	at: string;
	err: boolean;
	text: string;
}

export interface PodContainer {
	name: string;
	image: string;
	ready: boolean;
	restarts: number;
	state: string;
	reason: string | null;
}

export interface Pod {
	namespace: string;
	name: string;
	phase: string;
	node: string | null;
	ip: string | null;
	createdAt: number;
	owner: string | null;
	/** Why the whole pod is stuck or gone (Unschedulable, Evicted), and Kubernetes' explanation. */
	reason: string | null;
	message: string | null;
	containers: PodContainer[];
}

export interface Cluster {
	available: boolean;
	context: string | null;
	pods: Pod[];
	error: string | null;
}
