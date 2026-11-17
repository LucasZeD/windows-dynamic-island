import { PlayIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { Card, Row } from "../../components/ui/card";
import { command } from "../../core/bridge";
import { cn } from "../../core/cn";
import { useT } from "../../core/i18n";
import { readSetting, SOUND_TONES, type SoundTone, setSetting, soundSettings } from "../../core/settings";
import { Lead, Title } from "../components/Heading";
import { ToggleRow } from "../components/Toggle";

const play = (tone?: SoundTone) => command("play_toast_sound", { tone }).catch(() => {});

/** The app's sounds: how loud, and what plays when something finishes. */
export function SoundPage({ values }: { values: Record<string, unknown> }) {
	const t = useT();
	const navigate = useNavigate();
	const on = readSetting(values, soundSettings.toast);
	const chosen = readSetting(values, soundSettings.toastTone);

	return (
		<>
			<Title>{t("sound.title")}</Title>
			<Lead>{t("sound.lead")}</Lead>
			<Card>
				<VolumeRow value={readSetting(values, soundSettings.volume)} />
			</Card>
			<Card>
				<ToggleRow def={soundSettings.toast} value={on} />
				<div data-block className={cn("grid grid-cols-5 gap-2 pb-3.5", !on && "pointer-events-none opacity-40")}>
					{SOUND_TONES.map((tone) => (
						<button
							key={tone}
							type="button"
							aria-pressed={chosen === tone}
							className={cn(
								"flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl bg-white/3 text-[12.5px] font-semibold shadow-[inset_0_0_0_1px_var(--hairline)] transition-[background-color,box-shadow] hover:bg-white/6",
								chosen === tone && "bg-white/7 shadow-[inset_0_0_0_2px_var(--color-accent)]",
							)}
							onClick={() => {
								setSetting(soundSettings.toastTone, tone);
								play(tone);
							}}
						>
							<PlayIcon size={13} className="text-text-faint" />
							{t(`sound.tone.${tone}`)}
						</button>
					))}
				</div>
			</Card>
			<Card>
				<Row label={t("sound.agents.label")} desc={t("sound.agents.desc")}>
					<Button onClick={() => navigate("/modules/ai-agents")}>{t("sound.agents.open")}</Button>
				</Row>
			</Card>
		</>
	);
}

/** A slider; the setting (and a sample at the new volume) once it's let go. */
function VolumeRow({ value }: { value: number }) {
	const t = useT();
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		if (draft === value) return;
		setSetting(soundSettings.volume, draft);
		// The backend reads the volume from the settings: let the write land first.
		window.setTimeout(() => play(), 80);
	};

	return (
		<Row label={t(soundSettings.volume.label)} desc={t("sound.volume.desc")}>
			<div className="flex items-center gap-3">
				<input
					type="range"
					min={0}
					max={100}
					step={5}
					value={draft}
					aria-label={t(soundSettings.volume.label)}
					className="w-40 accent-accent"
					onChange={(e) => setDraft(Number(e.target.value))}
					onPointerUp={commit}
					onKeyUp={commit}
				/>
				<span className="w-9 text-right text-[12.5px] text-text-dim tabular-nums">{draft}%</span>
			</div>
		</Row>
	);
}
