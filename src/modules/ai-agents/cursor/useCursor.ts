import { providerAction, useProvider } from "../../../core/bridge";
import { type MessageKey, useT } from "../../../core/i18n";
import type { AgentSnapshot } from "../common/types";

/** Mirrors `CursorState` in `src-tauri/src/providers/cursor.rs`. */
export interface CursorState {
	available: boolean;
	signedIn: boolean;
	error: "signed-out" | "expired" | "network" | "api" | null;
	plan: string | null;
	limits: { id: "total" | "auto" | "api"; usedPct: number; resetsAt: number | null }[];
	/** Cursor's own message when the plan is used up. */
	message: string | null;
	tokensToday: { input: number; output: number; cacheRead: number; cacheWrite: number; messages: number };
	usage: { daily: { date: string; tokens: number; responses: number }[]; last5hTokens: number };
	updatedAt: number;
}

export const PROVIDER = "cursor";
export const CURSOR_COLOR = "#D4D4D8";

export const openCursor = () => providerAction(PROVIDER, "openApp");
// Stable: the agent card calls it while on screen (the backend throttles it).
const refresh = () => void providerAction(PROVIDER, "refresh");

const ERROR_TEXT: Record<NonNullable<CursorState["error"]>, MessageKey> = {
	"signed-out": "cursor.signedOut",
	expired: "cursor.expired",
	network: "cursor.network",
	api: "cursor.api",
};

/** Plan usage (Total / Auto / API) and tokens, from the Cursor account. No live sessions. */
export function useCursor(): AgentSnapshot {
	const state = useProvider<CursorState>(PROVIDER);
	const t = useT();

	if (!state?.available) return { available: false, sessions: [], limits: [] };

	const needsSignIn = state.error === "signed-out" || state.error === "expired";
	const hasData = state.updatedAt > 0 && !needsSignIn;
	return {
		available: true,
		sessions: [],
		limits: hasData
			? state.limits.map((l) => ({
					id: l.id,
					label: `${t(`cursor.limit.${l.id}`)} · ${t("cursor.cycle")}`,
					usedPct: l.usedPct,
					resetsAt: l.resetsAt,
				}))
			: [],
		limitsHint: state.error ? t(ERROR_TEXT[state.error]) : (state.message ?? undefined),
		refreshLimits: refresh,
		tokensToday: hasData ? state.tokensToday : undefined,
		usage: hasData ? state.usage : undefined,
		setup: needsSignIn
			? { message: t(ERROR_TEXT[state.error ?? "signed-out"]), actionLabel: t("cursor.open"), action: openCursor }
			: undefined,
	};
}
