import { emit } from "@tauri-apps/api/event";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { DEMO_NOTICE_EVENT } from "../../components/island/Notices";
import { LIQUID_EDGE, RimRing } from "../../components/island/Rim";
import { Button } from "../../components/ui/button";
import { Block, Card, card, Desc, Row } from "../../components/ui/card";
import { Segmented } from "../../components/ui/form";
import {
	BORDER_PRESETS,
	borderColors,
	glassOf,
	materialOf,
	PALETTE,
	resolveAppearance,
	rimBackground,
	styleOf,
	swatchBackground,
	THICKNESSES,
	themeOf,
	useSystemDark,
} from "../../core/appearance";
import { cn } from "../../core/cn";
import { type MessageKey, useT } from "../../core/i18n";
import {
	appearanceSettings,
	GLASS_LEVELS,
	ISLAND_HIDDEN_KEY,
	ISLAND_THEMES,
	type IslandStyle,
	type LiquidTint,
	type Material,
	readSetting,
	setSetting,
} from "../../core/settings";
import { useGlassSupported } from "../../core/useGlass";
import { Title } from "../components/Heading";
import { Toggle, ToggleRow } from "../components/Toggle";

const STYLES: { id: IslandStyle; name: MessageKey; desc: MessageKey }[] = [
	{ id: "dynamic", name: "appearance.style.dynamic", desc: "appearance.style.dynamicDesc" },
	{ id: "windows", name: "appearance.style.windows", desc: "appearance.style.windowsDesc" },
];

const MATERIAL_CARDS: { id: Material; name: MessageKey; desc: MessageKey }[] = [
	{ id: "solid", name: "appearance.material.solid", desc: "appearance.material.solidDesc" },
	{ id: "frosted", name: "appearance.material.frosted", desc: "appearance.material.frostedDesc" },
	{ id: "liquid", name: "appearance.material.liquid", desc: "appearance.material.liquidDesc" },
];

/** Look of the island: style, theme, material and border, each in its own section. */
export function AppearancePage({ values }: { values: Record<string, unknown> }) {
	const t = useT();
	const glassSupported = useGlassSupported();
	const look = resolveAppearance(values, useSystemDark());
	const style = styleOf(values);
	const material = materialOf(values);
	const border = readSetting(values, appearanceSettings.border);
	const custom = readSetting(values, appearanceSettings.customColors);
	const thickness = readSetting(values, appearanceSettings.thickness);
	const rim = borderColors(border, custom);
	const floating = style !== "dynamic";
	const hidden = values[ISLAND_HIDDEN_KEY] === true;
	const preview = { theme: look.theme, liquidTint: look.liquidTint, rim };

	return (
		<>
			<Title>{t("appearance.title")}</Title>

			<Card>
				<Block>
					<Row label={t("appearance.style.label")} desc={t("appearance.style.desc")} />
					<div className="grid grid-cols-2 gap-2.5">
						{STYLES.map((s) => (
							<Choice
								key={s.id}
								selected={style === s.id}
								name={t(s.name)}
								desc={t(s.desc)}
								onPick={() => setSetting(appearanceSettings.style, s.id)}
							>
								<Preview {...preview} style={s.id} material={material} />
							</Choice>
						))}
					</div>
				</Block>
				<Row
					label={t("appearance.restShape.label")}
					desc={floating ? t("appearance.restShape.desc") : t("appearance.floatingOnly")}
					disabled={!floating}
				>
					<Segmented
						options={[
							{ value: "orb", label: t("appearance.restShape.orb") },
							{ value: "pill", label: t("appearance.restShape.pill") },
						]}
						value={readSetting(values, appearanceSettings.restShape)}
						disabled={!floating}
						onChange={(value) => setSetting(appearanceSettings.restShape, value)}
					/>
				</Row>
				<Row label={t("appearance.preview.label")} desc={t("appearance.preview.desc")}>
					<div className="flex gap-2">
						<Button disabled={!look.orb} onClick={() => emit(DEMO_NOTICE_EVENT, "bubble").catch(() => {})}>
							{t("appearance.preview.bubble")}
						</Button>
						<Button
							// The pill shows news in itself: no bubbles or toasts.
							disabled={look.floating && !look.orb}
							onClick={() => emit(DEMO_NOTICE_EVENT, "toast").catch(() => {})}
						>
							{t("appearance.preview.toast")}
						</Button>
					</div>
				</Row>
				<ToggleRow def={appearanceSettings.idleClock} value={readSetting(values, appearanceSettings.idleClock)} />
				<Row
					label={t("appearance.tabsPosition.label")}
					desc={floating ? t("appearance.tabsPosition.desc") : t("appearance.floatingOnly")}
					disabled={!floating}
				>
					<Segmented
						options={[
							{ value: "top", label: t("appearance.tabsPosition.top") },
							{ value: "bottom", label: t("appearance.tabsPosition.bottom") },
						]}
						value={readSetting(values, appearanceSettings.tabsPosition)}
						disabled={!floating}
						onChange={(value) => setSetting(appearanceSettings.tabsPosition, value)}
					/>
				</Row>
			</Card>

			<Card>
				<Row label={t("appearance.theme.label")} desc={t("appearance.theme.desc")}>
					<Segmented
						options={ISLAND_THEMES.map((value) => ({ value, label: t(`appearance.theme.${value}`) }))}
						value={themeOf(values)}
						onChange={(value) => setSetting(appearanceSettings.theme, value)}
					/>
				</Row>
			</Card>

			<Card>
				<Block>
					<Row
						label={t("appearance.material.label")}
						desc={
							material !== "solid" && !glassSupported
								? t("appearance.material.needsGlass")
								: t("appearance.material.desc")
						}
					/>
					<div className="grid grid-cols-3 gap-2.5">
						{MATERIAL_CARDS.map((m) => (
							<Choice
								key={m.id}
								selected={material === m.id}
								name={t(m.name)}
								desc={t(m.desc)}
								onPick={() => {
									setSetting(appearanceSettings.material, m.id);
									// The old "liquid" style was the island made of Liquid Glass.
									if (values[appearanceSettings.style.key] === "liquid") {
										setSetting(appearanceSettings.style, "windows");
									}
								}}
							>
								<Preview {...preview} style={style} material={m.id} />
							</Choice>
						))}
					</div>
				</Block>
				{glassSupported && material !== "solid" && (
					<Row label={t("appearance.glass.label")} desc={t("appearance.glass.desc")}>
						<Segmented
							options={GLASS_LEVELS.filter((level) => level !== "off").map((level) => ({
								value: level,
								label: t(`appearance.glass.${level}`),
							}))}
							value={glassOf(values, material)}
							onChange={(level) => setSetting(appearanceSettings.glass, level)}
						/>
					</Row>
				)}
				{material === "liquid" && (
					<Row label={t("appearance.liquidTint.label")} desc={t("appearance.liquidTint.desc")}>
						<Segmented
							options={[
								{ value: "clear", label: t("appearance.liquidTint.clear") },
								{ value: "tinted", label: t("appearance.liquidTint.tinted") },
							]}
							value={look.liquidTint}
							onChange={(value) => setSetting(appearanceSettings.liquidTint, value)}
						/>
					</Row>
				)}
			</Card>

			<motion.section
				className={card()}
				initial={false}
				animate={{ opacity: floating ? 1 : 0.4 }}
				style={{ pointerEvents: floating ? "auto" : "none" }}
			>
				<Block>
					<Row
						label={t("appearance.border.label")}
						desc={floating ? t("appearance.border.desc") : t("appearance.floatingOnly")}
					>
						<span className="text-[13px] text-text-dim">
							{border === "custom"
								? t("appearance.preset.custom")
								: t(BORDER_PRESETS.find((p) => p.id === border)?.name ?? "appearance.preset.none")}
						</span>
					</Row>
					<div className="flex flex-wrap gap-1.5">
						{BORDER_PRESETS.map((p) => (
							<Swatch
								key={p.id}
								fill={swatchBackground(p.colors)}
								outlined={!p.colors.length}
								title={t(p.name)}
								selected={border === p.id}
								onPick={() => setSetting(appearanceSettings.border, p.id)}
							/>
						))}
						<Swatch
							fill={swatchBackground(custom)}
							title={t("appearance.preset.custom")}
							selected={border === "custom"}
							onPick={() => setSetting(appearanceSettings.border, "custom")}
							edit
						/>
					</div>
					{border === "custom" &&
						[0, 1].map((index) => (
							<div key={index} className="flex flex-col gap-1">
								<Desc>{t(index ? "appearance.custom.end" : "appearance.custom.start")}</Desc>
								<div className="flex flex-wrap gap-1.5">
									{PALETTE.map((color) => (
										<Swatch
											key={color}
											small
											fill={color}
											title={color}
											selected={custom[index]?.toLowerCase() === color.toLowerCase()}
											onPick={() => {
												const next = [custom[0] ?? PALETTE[7], custom[1] ?? PALETTE[4]];
												next[index] = color;
												setSetting(appearanceSettings.customColors, next);
											}}
										/>
									))}
								</div>
							</div>
						))}
				</Block>

				<Row label={t("appearance.thickness.label")} disabled={!rim.length}>
					<Segmented
						options={THICKNESSES.map((n) => ({ value: n, label: t(`appearance.thickness.${n}`) }))}
						value={thickness}
						disabled={!rim.length}
						onChange={(n) => setSetting(appearanceSettings.thickness, n)}
					/>
				</Row>
				<ToggleRow def={appearanceSettings.animate} value={readSetting(values, appearanceSettings.animate)} />
				<ToggleRow def={appearanceSettings.glow} value={readSetting(values, appearanceSettings.glow)} />
			</motion.section>

			<Card>
				<Row as="label" label={t("appearance.hide.label")} desc={t("appearance.hide.desc")}>
					<Toggle checked={hidden} onChange={(v) => setSetting(ISLAND_HIDDEN_KEY, v)} />
				</Row>
			</Card>
		</>
	);
}

/** A card to pick (a style or a material), with its miniature. */
function Choice({
	selected,
	name,
	desc,
	onPick,
	children,
}: {
	selected: boolean;
	name: string;
	desc: string;
	onPick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex flex-col gap-1 rounded-xl bg-white/3 px-2.5 pt-2.5 pb-3 text-left shadow-[inset_0_0_0_1px_var(--hairline)] transition-[box-shadow,background] duration-200 hover:bg-white/5",
				selected && "shadow-[inset_0_0_0_2px_var(--accent)]",
			)}
			aria-pressed={selected}
			onClick={onPick}
		>
			{children}
			<span className="mt-1.5 text-[13.5px] font-[650]">{name}</span>
			<Desc>{desc}</Desc>
		</button>
	);
}

/** Clear glass over the preview's backdrop. */
const LIQUID_PREVIEW =
	"backdrop-blur-sm shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.45),0_6px_14px_-6px_rgba(0,0,0,0.5)]";

/** The island's fill in a preview, per theme and material. */
function previewFill(theme: "dark" | "light", material: Material, tint: LiquidTint) {
	const light = theme === "light";
	// Literal colors: the settings window's own light theme swaps white and black.
	if (material === "solid") return light ? "bg-[#f4f4f7]" : "bg-[#000]";
	if (material === "frosted") return cn("backdrop-blur-sm", light ? "bg-[#fff]/66" : "bg-[#000]/55");
	const tinted = tint === "tinted";
	return cn(
		LIQUID_PREVIEW,
		light ? (tinted ? "bg-[#eeeef4]/80" : "bg-[#fff]/50") : tinted ? "bg-[#000]/62" : "bg-[#fff]/12",
	);
}

/** A miniature of the island in a given style, material and theme. */
function Preview({
	style,
	material,
	theme,
	liquidTint,
	rim,
}: {
	style: IslandStyle;
	material: Material;
	theme: "dark" | "light";
	liquidTint: LiquidTint;
	rim: string[];
}) {
	const notch = style === "dynamic";
	// The notch has no rim; Liquid Glass without a colored one catches the light.
	const liquidEdge = !notch && material === "liquid" && !rim.length;
	const edge = notch ? undefined : liquidEdge ? LIQUID_EDGE : rimBackground(rim);
	return (
		<div className="relative h-18.5 overflow-hidden rounded-lg bg-[radial-gradient(120%_120%_at_80%_100%,#6b3a5b_0%,#2a1a3a_45%,#0d0d17_100%)]">
			{/* Something behind the island: hidden by solid, showing through glass. */}
			<span className="absolute top-2.5 left-[42%] size-3 rounded-full bg-[#ff9f0a]" />
			<div
				className={cn(
					"absolute left-1/2 grid h-5.5 -translate-x-1/2 place-items-center",
					previewFill(theme, material, liquidTint),
					notch ? "top-0 w-23 rounded-b-xl" : "top-2 w-20 rounded-[11px]",
				)}
			>
				{edge && <RimRing background={edge} width={liquidEdge ? 1 : 1.5} />}
				{!notch && (
					<span className={cn("text-[9.5px] font-[650]", theme === "light" ? "text-[#1d1d1f]" : "text-[#fff]")}>
						9:41
					</span>
				)}
			</div>
		</div>
	);
}

function Swatch({
	fill,
	title,
	selected,
	onPick,
	outlined,
	small,
	edit,
}: {
	fill: string;
	title: string;
	selected: boolean;
	onPick: () => void;
	outlined?: boolean;
	small?: boolean;
	edit?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				"grid size-8 place-items-center rounded-full shadow-[inset_0_0_0_2px_transparent] transition-shadow duration-150 hover:shadow-[inset_0_0_0_2px_rgba(255,255,255,0.35)]",
				small && "size-6",
				selected && "shadow-[inset_0_0_0_2px_var(--color-white)] hover:shadow-[inset_0_0_0_2px_var(--color-white)]",
			)}
			title={title}
			aria-pressed={selected}
			onClick={onPick}
		>
			<span
				className={cn(
					"grid size-[calc(100%-8px)] place-items-center rounded-full text-[11px] text-[#fff] [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]",
					outlined && "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]",
				)}
				style={{ background: fill }}
			>
				{edit && "✎"}
			</span>
		</button>
	);
}
