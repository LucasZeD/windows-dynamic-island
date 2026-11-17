import { useCallback, useRef, useState } from "react";

/** The island reopens on the last tab used if it closed less than this ago. */
const REMEMBER_TAB_MS = 5 * 60_000;
/** Tabs the island reopens on however long ago it closed (the chats, notes). */
const STICKY_TABS = new Set(["chatgpt", "gemini", "notes"]);

/**
 * The tab the user is on (`null`: the default, the busiest module). It
 * outlives the island closing for a while, then it's back to the default.
 * On opening, a module waiting on the user wins over the remembered tab,
 * unless the island was opened on a specific one (`openOn`).
 */
export function useTabMemory(attentionId: string | null) {
	const [tab, setTab] = useState<string | null>(null);
	const rememberUntil = useRef(0);
	const attention = useRef(attentionId);
	attention.current = attentionId;
	const current = useRef(tab);
	current.current = tab;

	/** A tab asked for explicitly (a click, a shortcut): it stays while open. */
	const openOn = useCallback((id: string) => {
		setTab(id);
		rememberUntil.current = Infinity;
	}, []);

	const onIslandOpen = useCallback(() => {
		if (attention.current && rememberUntil.current !== Infinity) setTab(attention.current);
		else if (Date.now() > rememberUntil.current) setTab(null);
	}, []);

	const onIslandClose = useCallback(() => {
		const sticky = current.current !== null && STICKY_TABS.has(current.current);
		rememberUntil.current = sticky ? Number.MAX_SAFE_INTEGER : Date.now() + REMEMBER_TAB_MS;
	}, []);

	return { tab, setTab, openOn, onIslandOpen, onIslandClose };
}
