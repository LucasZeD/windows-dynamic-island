import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Divider, Row } from "../../../components/ui/card";
import { NumberField } from "../../../components/ui/form";
import { useProvider } from "../../../core/bridge";
import { useT } from "../../../core/i18n";
import { type SettingDef, setSetting, useSetting } from "../../../core/settings";
import {
	NOTES_HEIGHT,
	NOTES_PROVIDER,
	NOTES_WIDTH,
	type NotesState,
	notesAction,
	notesSettings,
	useNotesSize,
} from "../types";

/** Where the notes live, and how big the panel is. */
export function NotesSettings() {
	const t = useT();
	const state = useProvider<NotesState>(NOTES_PROVIDER);
	const picked = useSetting(notesSettings.folder);
	const size = useNotesSize();

	return (
		<>
			<Row label={t("notes.folder.label")} desc={state?.root ?? t("notes.folder.desc")}>
				<div className="flex flex-none gap-2">
					{picked && <Button onClick={() => notesAction("resetFolder")}>{t("notes.folder.reset")}</Button>}
					<Button onClick={() => notesAction("pickFolder")}>{t("notes.folder.change")}</Button>
				</div>
			</Row>
			<Divider />
			<PixelsRow def={notesSettings.width} value={size.width} range={NOTES_WIDTH} />
			<PixelsRow def={notesSettings.height} value={size.height} range={NOTES_HEIGHT} />
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
