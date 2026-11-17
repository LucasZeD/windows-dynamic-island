/**
 * ChatGPT and Gemini inside the island, each its own module (tab, settings,
 * shortcut), signed in with your own account: the chat plan, not API or
 * Codex tokens. Hovering opens them like any tab; they stay open when the
 * pointer leaves and close on a click outside, which doesn't reach the app
 * below. Backend: `src-tauri/src/providers/chat.rs`.
 */
import type { ReactNode } from "react";
import { ChatGptLogo, GeminiLogo } from "../../components/ui/AiLogos";
import type { MessageKey } from "../../core/i18n";
import type { IslandModule, ModuleView } from "../../core/types";
import { ChatPanel } from "./components/ChatPanel";
import { ChatSizeSettings } from "./components/ChatSizeSettings";
import { ChatTabBar } from "./components/ChatTabBar";
import { useChatSize } from "./size";
import { type ChatSite, SITES } from "./types";

const ICONS: Record<ChatSite, (size: number) => ReactNode> = {
	chatgpt: (size) => <ChatGptLogo size={size} />,
	gemini: (size) => <GeminiLogo size={size} />,
};

/** Module names: the "Ask" family, like Ask Claude. */
const TITLES: Record<ChatSite, MessageKey> = { chatgpt: "chat.askChatgpt", gemini: "chat.askGemini" };

function chatModule(site: ChatSite): IslandModule {
	const { accent } = SITES[site];
	const title = TITLES[site];
	const icon = ICONS[site];
	return {
		id: site,
		title,
		settingsIcon: icon(14),
		// The size is shared by both chats (Settings, either chat's page).
		SettingsSection: ChatSizeSettings,
		useView(): ModuleView {
			const size = useChatSize();
			return {
				active: false,
				priority: 0,
				accent,
				icon: icon(14),
				expanded: <ChatPanel site={site} />,
				expandedSize: size,
				tabBarExtra: <ChatTabBar site={site} />,
			};
		},
	};
}

export const chatgptModule = chatModule("chatgpt");
export const geminiModule = chatModule("gemini");
