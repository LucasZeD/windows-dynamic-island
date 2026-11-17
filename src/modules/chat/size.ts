import { readSetting, type SettingDef, useSettings } from "../../core/settings";

/** The chats' panel size (CSS px), shared by ChatGPT and Gemini. */
export const chatSizeSettings = {
	width: { key: "chat.width", label: "chat.size.width", default: 480 } satisfies SettingDef<number>,
	height: { key: "chat.height", label: "chat.size.height", default: 960 } satisfies SettingDef<number>,
};

export const CHAT_WIDTH = { min: 360, max: 1400 };
export const CHAT_HEIGHT = { min: 320, max: 1400 };

export const CHAT_PRESETS = [
	{ id: "tall", width: 480, height: 960 },
	{ id: "wide", width: 720, height: 514 },
	{ id: "large", width: 760, height: 900 },
] as const;

const clamp = (v: unknown, { min, max }: { min: number; max: number }, fallback: number) => {
	if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
	return Math.min(max, Math.max(min, Math.round(v)));
};

export function chatSize(values: Record<string, unknown>) {
	return {
		width: clamp(readSetting(values, chatSizeSettings.width), CHAT_WIDTH, chatSizeSettings.width.default),
		height: clamp(readSetting(values, chatSizeSettings.height), CHAT_HEIGHT, chatSizeSettings.height.default),
	};
}

/** The panel size (the island still caps the height to what fits on the screen). */
export function useChatSize() {
	return chatSize(useSettings());
}
