import {
	BatteryChargingIcon,
	BatteryMediumIcon,
	Gamepad2Icon,
	HeadphonesIcon,
	KeyboardIcon,
	MoonIcon,
	MouseIcon,
} from "lucide-react";
import { useEffect } from "react";
import { providerAction } from "../../../core/bridge";
import { useT } from "../../../core/i18n";
import { levelColor, PERIPHERALS_PROVIDER, type PeripheralDevice, type PeripheralsState } from "../types";

/** Cards per row; more devices scroll. */
export const PER_ROW = 3;

export function KindIcon({ kind, size, color }: { kind: string; size: number; color?: string }) {
	const props = { size, color, strokeWidth: 1.75 };
	switch (kind) {
		case "mouse":
			return <MouseIcon {...props} />;
		case "keyboard":
			return <KeyboardIcon {...props} />;
		case "headset":
		case "headphones":
			return <HeadphonesIcon {...props} />;
		case "gamepad":
		case "controller":
			return <Gamepad2Icon {...props} />;
		default:
			return <BatteryMediumIcon {...props} />;
	}
}

/** Every device Halo Battery's code found, with its level. */
export function PeripheralsPanel({ state }: { state: PeripheralsState | undefined }) {
	const t = useT();

	// Opening the tab reads the devices now instead of at the next poll (once a minute).
	useEffect(() => {
		providerAction(PERIPHERALS_PROVIDER, "poll", null);
	}, []);

	if (state?.error === "missing" || (state && !state.available)) {
		return <Message text={t("peripherals.missing")} />;
	}
	if (state?.error) {
		return <Message text={t("peripherals.restarting")} />;
	}
	if (!state?.ready) {
		return <Message text={t("peripherals.loading")} />;
	}
	if (state.devices.length === 0) {
		return <Message text={t("peripherals.empty")} hint={t("peripherals.emptyHint")} />;
	}

	return (
		<div className="flex h-full flex-col">
			<div className="grid min-h-0 flex-1 auto-rows-[84px] grid-cols-3 content-start gap-2 overflow-y-auto">
				{state.devices.map((d) => (
					<DeviceCard key={d.key} device={d} />
				))}
			</div>
			<span className="pt-1 text-right text-[10px] text-text-faint">{t("peripherals.credit")}</span>
		</div>
	);
}

function DeviceCard({ device: d }: { device: PeripheralDevice }) {
	const t = useT();
	const color = d.online ? levelColor(d) : "var(--color-text-faint)";
	const level = d.level == null ? "—" : `${d.level}%`;

	let status = "";
	if (!d.online) status = t("peripherals.asleep");
	else if (d.charging) status = t("peripherals.charging");
	else if (d.approx) status = d.approx;
	else if (d.secondsLeft != null) status = t("peripherals.left", { time: duration(d.secondsLeft, t) });

	return (
		<div className="flex min-w-0 flex-col rounded-[14px] bg-card px-2.5 pt-2 pb-2" title={d.name}>
			<div className="flex min-w-0 items-center gap-1.5 text-text-dim">
				<KindIcon kind={d.kind} size={14} />
				<span className="truncate text-[11px] font-medium">{d.name}</span>
			</div>
			<div className="mt-1 flex items-center gap-1.5">
				<span className="text-[22px]/[1.15] font-bold tabular-nums" style={{ color }}>
					{level}
				</span>
				{d.charging && <BatteryChargingIcon size={15} color={color} />}
				{!d.online && <MoonIcon size={13} className="text-text-faint" />}
			</div>
			<div className="mt-auto h-[4px] overflow-hidden rounded-full bg-white/10">
				<div
					className="h-full rounded-full transition-[width] duration-500"
					style={{ width: `${d.level ?? 0}%`, background: color }}
				/>
			</div>
			<span className="mt-1 truncate text-[10.5px] text-text-dim">{status || " "}</span>
		</div>
	);
}

function duration(seconds: number, t: ReturnType<typeof useT>): string {
	const minutes = Math.round(seconds / 60);
	if (minutes < 90) return t("peripherals.minutes", { n: Math.max(minutes, 1) });
	return t("peripherals.hours", { n: Math.round(minutes / 60) });
}

function Message({ text, hint }: { text: string; hint?: string }) {
	return (
		<div className="grid h-full place-items-center px-6 text-center">
			<div>
				<div className="text-[13px] text-text-faint">{text}</div>
				{hint && <div className="mt-1 text-[11px] text-text-faint/80">{hint}</div>}
			</div>
		</div>
	);
}
