import type { ReactNode } from "react";
import type { Appearance } from "../../core/appearance";
import { cn } from "../../core/cn";
import { type IslandController, LAUNCHER } from "../../core/useIslandController";
import { IdleClock } from "../IdleClock";
import type { Variant } from "./geometry";
import { Launcher } from "./Launcher";
import { Tabs } from "./Tabs";

/**
 * What fills the island in its current mode. `key` changes whenever the
 * content does, so the swap animates.
 */
export function islandContent(ctl: IslandController, look: Appearance, v: Variant): { key: string; node: ReactNode } {
	const { mode, primary, focused } = ctl;
	const floating = look.floating;

	// The orb: just the busiest module's glyph (its news pass by in bubbles).
	if (look.orb && mode === "compact" && primary) {
		return {
			key: `orb:${primary.module.id}`,
			node: <div className="grid h-full w-full place-items-center">{primary.view.icon}</div>,
		};
	}
	if (look.orb && (mode === "idle" || mode === "swallowed" || mode === "hidden")) {
		return {
			key: "orb",
			node: (
				<div className="grid h-full w-full place-items-center">
					<span className="size-1.5 rounded-full bg-white/45" />
				</div>
			),
		};
	}

	if (mode === "compact" && primary?.view.compact) {
		return {
			key: `compact:${primary.module.id}`,
			node: (
				<div className="flex h-full items-center justify-between pr-3 pl-2">
					<div className="flex min-w-0 items-center gap-2">{primary.view.compact.left}</div>
					<div className="flex min-w-0 items-center justify-end gap-2">{primary.view.compact.right}</div>
				</div>
			),
		};
	}

	if ((mode === "expanded" || mode === "peek") && (focused || ctl.launcher)) {
		const tabs = mode === "expanded" && (
			<Tabs
				entries={ctl.tabs}
				current={ctl.tab}
				onSelect={ctl.setTab}
				iconsOnly={floating}
				bottom={v.tabsAtBottom}
				transition={v.shellSpring}
				extra={ctl.launcher ? undefined : focused?.view.tabBarExtra}
				pinned={ctl.pinned}
				onPin={ctl.setPinned}
			/>
		);
		return {
			key: ctl.launcher ? `big:${LAUNCHER}` : `big:${focused?.module.id}`,
			node: (
				<div className={cn("flex h-full flex-col px-5 pt-3.5 pb-4.5", v.tabsAtBottom && "pb-2")}>
					{!v.tabsAtBottom && tabs}
					<div className="min-h-0 flex-1">
						{ctl.launcher ? <Launcher entries={ctl.entries} onSelect={ctl.setTab} /> : focused?.view.expanded}
					</div>
					{v.tabsAtBottom && tabs}
				</div>
			),
		};
	}

	if (floating && look.idleClock && (mode === "idle" || mode === "swallowed")) {
		return { key: "clock", node: <IdleClock /> };
	}

	return { key: "idle", node: null };
}
