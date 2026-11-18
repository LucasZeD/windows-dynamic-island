/**
 * Docker module — the containers of the current Docker context, by Compose
 * project. Each one unfolds into its details (image and build, volumes,
 * network, Kubernetes labels, live stats and logs) and can be started,
 * stopped, paused or restarted. A second view lists the pods of kubectl's
 * current context. A container that crashes or turns unhealthy pops up as a
 * toast, and keeps the compact island while it's unhealthy or restarting.
 * Backend: `src-tauri/src/providers/docker/`.
 */
import { useProvider } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { useSetting } from "../../core/settings";
import type { IslandModule, ModuleView } from "../../core/types";
import { useNow } from "../ai-agents/common/format";
import { DockerPanel } from "./components/DockerPanel";
import { DockerLogo } from "./components/Logos";
import { dockerSettings } from "./settings";
import {
	displayName,
	freshEvent,
	groups,
	inTrouble,
	KUBE_HEIGHT,
	KUBE_UNFOLDED_HEIGHT,
	listHeight,
	MESSAGE_HEIGHT,
	useUi,
} from "./status";
import { DOCKER_ACCENT, DOCKER_PROVIDER, type DockerState } from "./types";

const WIDTH = 640;

export const dockerModule: IslandModule = {
	id: "docker",
	title: "docker.title",
	settingsIcon: <DockerLogo size={15} />,
	settings: Object.values(dockerSettings),
	useView(): ModuleView {
		const t = useT();
		const state = useProvider<DockerState>(DOCKER_PROVIDER);
		const notify = useSetting(dockerSettings.notifyCrashes);
		const showStopped = useSetting(dockerSettings.showStopped);
		const ui = useUi();
		const now = useNow(30_000, !!state?.events?.length);

		const containers = state?.containers ?? [];
		const trouble = containers.find(inTrouble);
		const event = notify ? freshEvent(state, now) : null;

		let height: number;
		if (ui.view === "kube") height = ui.unfolded ? KUBE_UNFOLDED_HEIGHT : KUBE_HEIGHT;
		else if (!state?.running) height = MESSAGE_HEIGHT + 44;
		else height = listHeight(groups(containers, showStopped), ui.unfolded);

		const troubleText = trouble
			? t(trouble.state === "restarting" ? "docker.compact.restarting" : "docker.compact.unhealthy")
			: "";

		return {
			active: trouble != null,
			priority: 4,
			accent: DOCKER_ACCENT,
			icon: <DockerLogo size={16} />,
			compact: trouble
				? {
						left: <DockerLogo size={16} />,
						right: (
							<span className="truncate text-[12.5px] font-semibold text-danger">
								{displayName(trouble)} · {troubleText}
							</span>
						),
						width: 280,
					}
				: undefined,
			expanded: <DockerPanel state={state} />,
			expandedSize: { width: WIDTH, height },
			notice: event
				? {
						key: `docker:${event.key}`,
						kind: "toast",
						content: (
							<>
								<DockerLogo size={16} />
								<span className="truncate text-[13px] font-semibold">
									{t(`docker.toast.${event.kind}`, { name: event.container, code: event.exitCode })}
								</span>
							</>
						),
					}
				: undefined,
		};
	},
};
