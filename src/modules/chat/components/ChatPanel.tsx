import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../../../core/appearance";
import { providerAction, useTauriEvent } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { useIsland } from "../../../core/island";
import { CHAT_PROVIDER, type ChatSite, DISMISS_EVENT, LOADED_EVENT, SITES } from "../types";

/** Frames the panel must keep still (the island springs open) before the page goes over it. */
const STILL_FRAMES = 3;
/** Frames the island must keep still after a drag before the page comes back (~0.1 s). */
const RESUME_FRAMES = 6;

/**
 * Room for the site's page: the backend lays the site's window over this box.
 * What's drawn here only shows while the page loads, or if it can't open.
 * Leaving doesn't close the island while it's here; a click outside does.
 */
export function ChatPanel({ site }: { site: ChatSite }) {
	const t = useT();
	const island = useIsland();
	const box = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	// Loaded: the page covers the box (pages are see-through, so nothing is drawn under them).
	// Until then the text below shows through it.
	const [loaded, setLoaded] = useState(false);
	const visible = island.mode === "expanded" && island.tab === site;
	// The site's own light / dark look follows the island's.
	const { theme } = useAppearance();

	// biome-ignore lint/correctness/useExhaustiveDependencies: hold for as long as the panel exists
	useEffect(() => {
		const hold = `chat:${site}`;
		island.keepOpen(true, hold);
		return () => {
			island.keepOpen(false, hold);
			providerAction(CHAT_PROVIDER, "hide", site);
		};
	}, []);

	// Collapsing or switching tabs: the page goes away at once, not after the exit animation.
	useEffect(() => {
		if (!visible) providerAction(CHAT_PROVIDER, "hide", site);
	}, [visible, site]);

	useTauriEvent(DISMISS_EVENT, () => island.collapse());
	useTauriEvent<string>(LOADED_EVENT, (s) => s === site && setLoaded(true));

	// Follow the box: once it holds still, place the page over it. When it moves
	// again (the island dragged), the page steps away at once and comes back
	// shortly after the island stops: a window can't keep up with the drag's
	// squash & stretch, and lagging behind it looks broken.
	useEffect(() => {
		const el = box.current;
		if (!visible || !el) return;
		setError(null);
		let frame = 0;
		let last = "";
		let still = 0;
		let placedKey = "";
		let parked = false;
		const tick = () => {
			frame = requestAnimationFrame(tick);
			const r = el.getBoundingClientRect();
			const key = [r.x, r.y, r.width, r.height].map(Math.round).join();
			still = key === last ? still + 1 : 0;
			last = key;
			if (key === placedKey || !r.width || !r.height) return;
			if (placedKey && !parked) {
				parked = true;
				providerAction(CHAT_PROVIDER, "park", site).catch(() => {});
			}
			if (still < (parked ? RESUME_FRAMES : STILL_FRAMES)) return;
			placedKey = key;
			parked = false;
			providerAction(CHAT_PROVIDER, "show", { site, x: r.x, y: r.y, width: r.width, height: r.height, theme })
				.then((r) => (r as { loaded?: boolean } | null)?.loaded && setLoaded(true))
				.catch((e) => setError(String(e)));
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [visible, site, theme]);

	const name = t(SITES[site].title);
	return (
		<div ref={box} className="grid h-full w-full place-items-center">
			<div className={cn("text-center", loaded && !error && "invisible")}>
				<div className="text-[13px] text-text-faint">
					{error ? t("chat.failed", { site: name }) : t("chat.loading", { site: name })}
				</div>
				{error && <div className="mt-1 text-[11px] text-text-faint/70">{error}</div>}
			</div>
		</div>
	);
}
