import { LayoutGridIcon, PinIcon, SettingsIcon } from "lucide-react";
import { motion, type Transition } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { command } from "../../core/bridge";
import { cn } from "../../core/cn";
import { useT } from "../../core/i18n";
import type { ModuleEntry } from "../../core/types";
import { ASK_TABS, LAUNCHER } from "../../core/useIslandController";

const tabs = tv({
	slots: {
		/** Room on the right for the pin, which sits apart from the tabs at the far edge. */
		base: "relative mb-2.5 flex gap-1 pr-9.5",
		tab: "relative flex h-7.5 items-center gap-1.75 rounded-[15px] pr-3 pl-2 text-[13px] font-semibold text-text-dim transition-colors duration-200 hover:text-text",
		pill: "absolute inset-0 rounded-[inherit] bg-white/10",
		part: "relative grid place-items-center",
		dot: "relative size-1.25 rounded-full bg-ok",
		extra: "ml-auto flex items-center gap-1.5",
		/** The Ask chats: one segmented switch at the right end. */
		ask: "relative ml-auto flex h-7.5 items-center gap-0.5 rounded-full bg-white/6 p-0.75",
		askItem:
			"relative grid h-6 w-8 place-items-center rounded-full opacity-60 transition-opacity duration-200 hover:opacity-100",
		askPill: "absolute inset-0 rounded-[inherit] bg-white/14 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
		gear: "grid size-7.5 place-items-center rounded-full text-text-faint transition-colors duration-200 hover:bg-white/8 hover:text-text",
		pin: "absolute top-1/2 right-0 grid size-7.5 -translate-y-1/2 place-items-center rounded-full text-text-faint transition-colors duration-200 hover:bg-white/8 hover:text-text",
	},
	variants: {
		active: { true: { tab: "text-text" } },
		pinned: { true: { pin: "bg-white/10 text-text" } },
		/** The launcher's grid button, pushed right with the gear. */
		launcher: { true: { tab: "ml-auto w-7.5 justify-center p-0" } },
		/** After the Ask switch, which already took the free space. */
		afterAsk: { true: { tab: "ml-1.5", extra: "ml-1.5" } },
		/** Windows Island: round icon tabs, ringed in the module's color. */
		iconsOnly: {
			true: {
				tab: "w-8 justify-center rounded-full p-0 opacity-55 transition-opacity hover:opacity-100",
				pill: "shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--tab-accent)_70%,transparent)]",
				dot: "absolute top-0.75 right-0.75 shadow-[0_0_0_1.5px_#000]",
			},
		},
		bottom: {
			true: { base: "m-0 mt-2 justify-center px-9.5", extra: "ml-1.5", gear: "ml-1.5" },
		},
	},
	compoundVariants: [
		{ iconsOnly: true, active: true, class: { tab: "opacity-100" } },
		{ iconsOnly: true, launcher: true, class: { tab: "ml-1.5 w-8 [--tab-accent:#fff]" } },
	],
});

export function Tabs({
	entries,
	current,
	onSelect,
	iconsOnly,
	bottom,
	transition,
	extra,
	pinned,
	onPin,
}: {
	entries: ModuleEntry[];
	current: string | null;
	onSelect: (id: string) => void;
	iconsOnly: boolean;
	/** Below the content (Windows Island): centered. */
	bottom: boolean;
	transition: Transition;
	/** The open module's `tabBarExtra`, shown next to the gear. */
	extra?: ReactNode;
	/** Kept open whatever the pointer does; the pin button sits at the far right. */
	pinned: boolean;
	onPin: (pinned: boolean) => void;
}) {
	const t = useT();
	const s = tabs({ iconsOnly, bottom });
	const pill = <motion.span layoutId="tab-pill" className={s.pill()} transition={transition} />;
	const tools = entries.filter((e) => !ASK_TABS.includes(e.module.id));
	const asks = entries.filter((e) => ASK_TABS.includes(e.module.id));
	return (
		<div className={s.base()}>
			{tools.map(({ module, view }) => {
				const selected = current === module.id;
				return (
					<button
						type="button"
						key={module.id}
						className={s.tab({ active: selected })}
						title={t(module.title)}
						style={{ "--tab-accent": view.accent ?? "#fff" } as CSSProperties}
						onClick={() => onSelect(module.id)}
					>
						{selected && pill}
						<span className={s.part()}>{view.icon}</span>
						{/* Many modules: only the open tab spells out its name. */}
						{!iconsOnly && selected && <span className={s.part()}>{t(module.title)}</span>}
						{view.active && !selected && <span className={s.dot()} />}
					</button>
				);
			})}
			{asks.length > 0 && (
				<div className={s.ask()}>
					{asks.map(({ module, view }) => (
						<button
							type="button"
							key={module.id}
							className={cn(s.askItem(), current === module.id && "opacity-100")}
							title={t(module.title)}
							onClick={() => onSelect(module.id)}
						>
							{current === module.id && (
								<motion.span layoutId="ask-pill" className={s.askPill()} transition={transition} />
							)}
							<span className="relative grid place-items-center">{view.icon}</span>
							{view.active && current !== module.id && <span className={cn(s.dot(), "absolute top-0.5 right-1")} />}
						</button>
					))}
				</div>
			)}
			<button
				type="button"
				className={s.tab({ active: current === LAUNCHER, launcher: true, afterAsk: asks.length > 0 })}
				title={t("layout.launcher")}
				onClick={(e) => {
					e.stopPropagation();
					onSelect(LAUNCHER);
				}}
			>
				{current === LAUNCHER && pill}
				<span className={s.part()}>
					<LayoutGridIcon size={14} />
				</span>
			</button>
			{/* Sliders inside: pressing them must not drag the island. */}
			{extra && (
				<div className={s.extra({ afterAsk: asks.length > 0 })} data-no-drag>
					{extra}
				</div>
			)}
			<motion.button
				className={s.gear()}
				title={t("island.settings")}
				whileHover={{ rotate: 45 }}
				whileTap={{ scale: 0.85 }}
				transition={{ type: "spring", stiffness: 300, damping: 15 }}
				onClick={(e) => {
					e.stopPropagation();
					command("open_settings");
				}}
			>
				<SettingsIcon size={16} />
			</motion.button>
			<motion.button
				className={s.pin({ pinned })}
				title={t(pinned ? "island.unpin" : "island.pin")}
				aria-pressed={pinned}
				whileTap={{ scale: 0.85 }}
				onClick={(e) => {
					e.stopPropagation();
					onPin(!pinned);
				}}
			>
				<motion.span
					className="grid place-items-center"
					initial={false}
					animate={{ rotate: pinned ? 0 : 45 }}
					transition={{ type: "spring", stiffness: 300, damping: 18 }}
				>
					<PinIcon size={15} fill={pinned ? "currentColor" : "none"} />
				</motion.span>
			</motion.button>
		</div>
	);
}
