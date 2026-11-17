import { useEffect, useState } from "react";
import { Row } from "../../../components/ui/card";
import { NumberField, Segmented } from "../../../components/ui/form";
import { useT } from "../../../core/i18n";
import { type SettingDef, setSetting } from "../../../core/settings";
import { CHAT_HEIGHT, CHAT_PRESETS, CHAT_WIDTH, chatSizeSettings, useChatSize } from "../size";

/** Size of the chat panel: a preset, or any width and height. */
export function ChatSizeSettings() {
	const t = useT();
	const size = useChatSize();
	const preset = CHAT_PRESETS.find((p) => p.width === size.width && p.height === size.height)?.id ?? "custom";

	return (
		<>
			<Row label={t("chat.size.label")} desc={t("chat.size.desc")}>
				<Segmented
					options={[
						...CHAT_PRESETS.map((p) => ({ value: p.id, label: t(`chat.size.${p.id}`) })),
						{ value: "custom" as const, label: t("chat.size.custom") },
					]}
					value={preset}
					onChange={(id) => {
						const p = CHAT_PRESETS.find((x) => x.id === id);
						if (!p) return;
						setSetting(chatSizeSettings.width, p.width);
						setSetting(chatSizeSettings.height, p.height);
					}}
				/>
			</Row>
			<PixelsRow def={chatSizeSettings.width} value={size.width} range={CHAT_WIDTH} />
			<PixelsRow def={chatSizeSettings.height} value={size.height} range={CHAT_HEIGHT} />
		</>
	);
}

function PixelsRow({
	def,
	value,
	range,
}: {
	def: SettingDef<number>;
	value: number;
	range: { min: number; max: number };
}) {
	const t = useT();
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	const commit = () => {
		const n = Math.round(Number(draft));
		if (Number.isFinite(n) && n >= range.min && n <= range.max) setSetting(def, n);
		else setDraft(String(value));
	};

	return (
		<Row as="label" label={t(def.label)}>
			<NumberField
				unit="px"
				min={range.min}
				max={range.max}
				step={10}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
			/>
		</Row>
	);
}
