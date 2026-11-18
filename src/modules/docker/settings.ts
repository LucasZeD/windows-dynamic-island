import type { SettingDef } from "../../core/settings";

export const dockerSettings = {
	/** A toast when a container crashes, runs out of memory or turns unhealthy. */
	notifyCrashes: {
		key: "docker.notifyCrashes",
		label: "docker.notifyCrashes.label",
		description: "docker.notifyCrashes.desc",
		default: true,
	},
	/** Stopped containers stay in the list. */
	showStopped: {
		key: "docker.showStopped",
		label: "docker.showStopped.label",
		description: "docker.showStopped.desc",
		default: true,
	},
} satisfies Record<string, SettingDef>;
