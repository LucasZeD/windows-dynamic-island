import { type ReactNode, useEffect, useRef, useState } from "react";
import { providerAction } from "../../../core/bridge";
import { cn } from "../../../core/cn";
import { DOCKER_PROVIDER, type LogLine } from "../types";

/**
 * Asks the provider for something now and every `every` ms while mounted
 * (`every` 0: once). Keeps the last answer while the next one comes.
 */
export function usePolled<T>(action: string, payload: unknown, every: number, enabled = true) {
	const [data, setData] = useState<T | null>(null);
	const [error, setError] = useState<string | null>(null);
	const key = JSON.stringify(payload);

	useEffect(() => {
		if (!enabled) return;
		let alive = true;
		const load = () =>
			providerAction<T>(DOCKER_PROVIDER, action, JSON.parse(key))
				.then((d) => {
					if (!alive) return;
					setData(d);
					setError(null);
				})
				.catch((e) => alive && setError(String(e)));
		load();
		const timer = every > 0 ? setInterval(load, every) : undefined;
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [action, key, every, enabled]);

	return { data, error };
}

/** A label and its value, in a two-column grid. */
export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
	return (
		<>
			<span className="text-text-faint">{label}</span>
			<span className={cn("min-w-0 break-all text-text", mono && "font-mono text-[11px]")}>{children}</span>
		</>
	);
}

export function Grid({ children }: { children: ReactNode }) {
	return <div className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-[11.5px]">{children}</div>;
}

export function Heading({ children }: { children: ReactNode }) {
	return (
		<div className="mt-2.5 mb-1 text-[10.5px] font-bold tracking-wide text-text-faint uppercase first:mt-0">
			{children}
		</div>
	);
}

export function Empty({ text }: { text: string }) {
	return <div className="py-6 text-center text-[12px] text-text-faint">{text}</div>;
}

/** The line's local time of day, from Docker's RFC 3339 (UTC). */
function clock(at: string): string {
	const ms = Date.parse(at);
	return Number.isNaN(ms) ? "" : new Date(ms).toLocaleTimeString([], { hour12: false });
}

/** Log lines, following the end unless the user scrolled up to read. */
export function LogView({ lines, empty }: { lines: LogLine[] | null; empty: string }) {
	const box = useRef<HTMLDivElement>(null);
	const follow = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on each new batch of lines
	useEffect(() => {
		const el = box.current;
		if (el && follow.current) el.scrollTop = el.scrollHeight;
	}, [lines]);

	if (lines && lines.length === 0) return <Empty text={empty} />;
	return (
		<div
			ref={box}
			data-scroll
			onScroll={(e) => {
				const el = e.currentTarget;
				follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
			}}
			className="h-full overflow-auto rounded-lg bg-black/25 px-2 py-1.5 font-mono text-[10.5px]/[1.45] select-text [&::-webkit-scrollbar]:size-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/14"
		>
			{(lines ?? []).map((l, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: log lines have no id and never reorder
				<div key={i} className="flex gap-2 whitespace-pre-wrap">
					<span className="flex-none text-text-faint">{clock(l.at)}</span>
					<span className={cn("min-w-0 break-all", l.err ? "text-danger" : "text-text-dim")}>{l.text}</span>
				</div>
			))}
		</div>
	);
}

/** A centered message filling the panel. */
export function Message({ text, hint }: { text: string; hint?: string }) {
	return (
		<div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
			<div>
				<div className="text-[13px] text-text-faint">{text}</div>
				{hint && <div className="mt-1 text-[11px] break-words text-text-faint/80">{hint}</div>}
			</div>
		</div>
	);
}
