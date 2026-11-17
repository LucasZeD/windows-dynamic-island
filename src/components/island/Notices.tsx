import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Appearance } from "../../core/appearance";
import { command, useTauriEvent } from "../../core/bridge";
import { useT } from "../../core/i18n";
import { readSetting, soundSettings, useSettings } from "../../core/settings";
import type { IslandMode, ModuleEntry } from "../../core/types";
import { ClaudeLogo } from "../ui/AiLogos";
import { GlassProbes } from "./GlassProbes";

/** Settings → Appearance → Preview: show a sample bubble or toast (payload: the kind). */
export const DEMO_NOTICE_EVENT = "island://demo-notice";

/** How long news stays in a speech bubble, and a "finished" toast (ms). */
const BUBBLE_MS = 4500;
const TOAST_MS = 5500;
/** The same news again within this long (e.g. the slot going back to a session) isn't news. */
const REPEAT_MS = 120_000;
/** Toasts shown at once; an older one leaves when there'd be more. */
const MAX_TOASTS = 4;
/** Each older toast in the stack sits this much further right and down (px), and a bit smaller. */
const STACK_X = 12;
const STACK_Y = 9;
const STACK_SCALE = 0.04;
/** The chime waits for the toast to land. */
const CHIME_DELAY_MS = 220;
/**
 * With its own "done" sound on (`agents.soundDone`), a Claude Code task's toast
 * stays quiet: one sound is enough. The AI agents' notice keys start with the agent.
 */
const AGENTS_DONE_SOUND = "agents.soundDone";
const hasOwnSound = (moduleId: string | null, key: string) => moduleId === "ai-agents" && key.startsWith("claude:");

interface Bubble {
	id: number;
	key: string;
	moduleId: string | null;
	/** Fixed content (a sample); otherwise the module's live content. */
	node?: ReactNode;
}

interface Toast {
	id: number;
	/** What it's about (`ModuleView.notice.key`). */
	key: string;
	moduleId: string | null;
	node: ReactNode;
	/** The module told it its own way (Claude's "done" glyph): no check mark. */
	own: boolean;
}

/**
 * The news a module announces (`ModuleView.notice`, or taking the main slot),
 * shown once while the island rests and then gone:
 * - the orb: a comic speech bubble at its side, and toasts dropping below it
 *   when something finishes, stacking up when several come in a row;
 * - the notch: the pill already says it, so a finished task just lets a drop
 *   fall from the notch.
 * A finished task plays a short tone (Settings → Sound).
 */
export function Notices({
	primary,
	entries,
	mode,
	look,
	transition,
	rim,
	beside,
	onOpen,
}: {
	primary: ModuleEntry | undefined;
	entries: ModuleEntry[];
	mode: IslandMode;
	look: Appearance;
	transition: Transition;
	rim: ReactNode;
	/** The side bubble is right of the island: the speech bubble goes past it. */
	beside: boolean;
	onOpen: (moduleId: string) => void;
}) {
	const { bubble, toasts } = useNews(primary, entries);
	const resting = mode === "compact" || mode === "idle";

	// The bubble's live content while it lasts; the last known one if the module just went quiet.
	const entry = entries.find((e) => e.module.id === bubble?.moduleId);
	const last = useRef<{ id: number; node: ReactNode } | null>(null);
	const own = entry?.view.notice;
	const live =
		bubble?.node ??
		(own?.key === bubble?.key && own?.content
			? own.content
			: entry?.view.compact && (
					<>
						{entry.view.compact.left}
						{entry.view.compact.right}
					</>
				));
	if (bubble && live) last.current = { id: bubble.id, node: live };
	const bubbleBody = bubble && last.current?.id === bubble.id ? last.current.node : null;

	if (!look.floating) {
		const latest = toasts[0];
		return <Drop show={!!latest && resting} id={latest?.id} />;
	}
	if (!look.orb) return null;

	const open = (moduleId: string | null) => moduleId && onOpen(moduleId);
	const shownBubble = resting ? bubble : null;
	const shownToasts = resting ? toasts : [];
	return (
		<>
			<AnimatePresence>
				{shownBubble && (
					<motion.button
						key={`bubble:${shownBubble.id}`}
						type="button"
						data-hit
						data-glass
						style={{ left: `calc(100% + ${beside ? 62 : 14}px)` }}
						className="absolute top-0 flex h-10 max-w-90 origin-left items-center gap-2 rounded-[20px] bg-island py-0 pr-3.5 pl-2.5 whitespace-nowrap shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)]"
						initial={{ opacity: 0, scale: 0.4, x: -18 }}
						animate={{ opacity: 1, scale: 1, x: 0 }}
						exit={{ opacity: 0, scale: 0.6, x: -12, transition: { duration: 0.18 } }}
						transition={transition}
						onClick={(e) => {
							e.stopPropagation();
							open(shownBubble.moduleId);
						}}
					>
						{/* The comic tail, pointing at the orb. */}
						<span className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 rounded-[2px] bg-island" />
						<span className="relative flex min-w-0 items-center gap-2 overflow-hidden">{bubbleBody}</span>
						{rim}
						<GlassProbes />
					</motion.button>
				)}
			</AnimatePresence>
			<AnimatePresence>
				{shownToasts.map((toast, depth) => (
					<motion.button
						key={`toast:${toast.id}`}
						type="button"
						data-hit
						data-glass
						// The newest on top; older ones peek out to the right and below it.
						style={{ zIndex: MAX_TOASTS - depth }}
						className="absolute top-[calc(100%+10px)] left-1/2 flex h-10 max-w-90 -translate-x-1/2 origin-top-left items-center gap-2 rounded-[14px] bg-island pr-3.5 pl-2 whitespace-nowrap shadow-[0_14px_30px_-12px_rgba(0,0,0,0.75)]"
						initial={{ opacity: 0, y: -16, x: 0, scale: 0.7 }}
						animate={{
							opacity: depth ? 0.9 : 1,
							x: depth * STACK_X,
							y: depth * STACK_Y,
							scale: 1 - depth * STACK_SCALE,
						}}
						exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.2 } }}
						transition={transition}
						onClick={(e) => {
							e.stopPropagation();
							open(toast.moduleId);
						}}
					>
						{/* Cards behind keep their size but not their text: through glass it would show. */}
						<motion.span
							className="flex min-w-0 items-center gap-2"
							initial={false}
							animate={{ opacity: depth ? 0 : 1 }}
							transition={{ duration: 0.15 }}
						>
							{!toast.own && (
								<span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-ok/20 text-ok">
									<CheckIcon size={13} strokeWidth={3} />
								</span>
							)}
							<span className="relative flex min-w-0 items-center gap-2 overflow-hidden">{toast.node}</span>
						</motion.span>
						{rim}
						<GlassProbes />
					</motion.button>
				))}
			</AnimatePresence>
		</>
	);
}

/**
 * A drop that swells under the notch, lets go and falls, then bursts into a
 * check: something finished.
 */
function Drop({ show, id }: { show: boolean; id: number | undefined }) {
	return (
		<AnimatePresence>
			{show && (
				<motion.span
					key={`drop:${id}`}
					className="pointer-events-none absolute top-full left-1/2 grid size-6 -translate-x-1/2 place-items-center rounded-full bg-island text-ok"
					initial={{ y: -14, scaleX: 0.45, scaleY: 0.2, opacity: 0.9 }}
					animate={{
						y: [-14, -6, 26, 22],
						scaleX: [0.45, 0.8, 0.9, 1],
						scaleY: [0.2, 1.25, 1.1, 1],
						opacity: 1,
						transition: { duration: 0.9, times: [0, 0.35, 0.8, 1], ease: "easeOut" },
					}}
					exit={{ scale: 1.8, opacity: 0, transition: { duration: 0.35 } }}
				>
					<CheckIcon size={13} strokeWidth={3} />
				</motion.span>
			)}
		</AnimatePresence>
	);
}

/**
 * What's being announced: one speech bubble (news of the module in the main
 * slot) and the stack of toasts (something finished, in any module), newest
 * first. Samples from the settings window go through the same paths.
 */
function useNews(primary: ModuleEntry | undefined, entries: ModuleEntry[]) {
	const t = useT();
	const settings = useSettings();
	const [bubble, setBubble] = useState<Bubble | null>(null);
	const [toasts, setToasts] = useState<Toast[]>([]);
	const counter = useRef(0);
	const nextId = () => ++counter.current;

	// The sound settings, read when a toast comes in (not a reason to re-run anything).
	const soundRef = useRef({ chime: true, agentsSound: false });
	soundRef.current = {
		chime: readSetting(settings, soundSettings.toast),
		agentsSound: settings[AGENTS_DONE_SOUND] === true,
	};

	const pushToast = useCallback((toast: Omit<Toast, "id">) => {
		const id = ++counter.current;
		setToasts((list) => [{ id, ...toast }, ...list].slice(0, MAX_TOASTS));
		window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), TOAST_MS);
		const { chime, agentsSound } = soundRef.current;
		if (chime && !(agentsSound && hasOwnSound(toast.moduleId, toast.key))) {
			window.setTimeout(() => command("play_toast_sound").catch(() => {}), CHIME_DELAY_MS);
		}
	}, []);

	useEffect(() => {
		if (!bubble) return;
		const id = window.setTimeout(() => setBubble(null), BUBBLE_MS);
		return () => window.clearTimeout(id);
	}, [bubble]);

	// Samples from Settings → Appearance → Preview.
	useTauriEvent<"bubble" | "toast">(DEMO_NOTICE_EVENT, (kind) => {
		const sample = (text: string) => (
			<>
				<ClaudeLogo size={16} />
				<span className="text-[13px] font-semibold">{text}</span>
			</>
		);
		if (kind === "toast") {
			pushToast({ key: "demo", moduleId: null, own: false, node: sample(t("appearance.preview.toastText")) });
		} else {
			setBubble({ id: nextId(), key: "demo", moduleId: null, node: sample(t("appearance.preview.bubbleText")) });
		}
	});

	// --- real news -----------------------------------------------------------------
	const started = useRef(false);
	const recent = useRef(new Map<string, number>());
	const seen = useRef(new Set<string>());

	interface Candidate {
		key: string;
		kind: "bubble" | "toast";
		moduleId: string;
		/** What the toast says, as it is right now (it outlives the module's own notice). */
		node: ReactNode;
		own: boolean;
	}
	const candidates: Candidate[] = [];
	const describe = (entry: ModuleEntry) => {
		const n = entry.view.notice;
		if (n?.content) return { node: n.content, own: true };
		const compact = entry.view.compact;
		return {
			node: compact && (
				<>
					{compact.left}
					{compact.right}
				</>
			),
			own: false,
		};
	};
	if (primary) {
		const n = primary.view.notice;
		candidates.push({
			key: n?.key ?? `module:${primary.module.id}`,
			kind: n?.kind ?? "bubble",
			moduleId: primary.module.id,
			...describe(primary),
		});
	}
	for (const entry of entries) {
		const n = entry.view.notice;
		if (n?.kind === "toast" && entry.module.id !== primary?.module.id) {
			candidates.push({ key: n.key, kind: "toast", moduleId: entry.module.id, ...describe(entry) });
		}
	}
	const signature = candidates.map((c) => `${c.moduleId}|${c.kind}|${c.key}`).join(";");

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the signature (a new array each render)
	useEffect(() => {
		const before = seen.current;
		seen.current = new Set(candidates.map((c) => c.key));
		// What's there at startup isn't news.
		const first = !started.current;
		started.current = true;
		if (first) return;
		const now = Date.now();
		for (const [k, at] of recent.current) if (now - at > REPEAT_MS) recent.current.delete(k);
		const fresh = candidates.filter((c) => !before.has(c.key) && !recent.current.has(c.key));
		for (const c of fresh) recent.current.set(c.key, now);
		// Every finished task gets its toast; the newest bubble replaces the last one.
		for (const c of fresh.filter((c) => c.kind === "toast")) {
			pushToast({ key: c.key, moduleId: c.moduleId, node: c.node, own: c.own });
		}
		const news = fresh.find((c) => c.kind === "bubble");
		if (news && !fresh.some((c) => c.kind === "toast")) {
			setBubble({ id: nextId(), key: news.key, moduleId: news.moduleId });
		}
	}, [signature]);

	return { bubble, toasts };
}
