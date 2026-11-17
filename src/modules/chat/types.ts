import type { MessageKey } from "../../core/i18n";

export const CHAT_PROVIDER = "chat";
/** Sent by the backend when a click outside the island closes the chat. */
export const DISMISS_EVENT = "chat://dismiss";
/** A site's page finished loading (payload: the site). */
export const LOADED_EVENT = "chat://loaded";

/** Also the module ids (and tab ids) of the two chat modules. */
export type ChatSite = "chatgpt" | "gemini";

export interface SiteInfo {
	id: ChatSite;
	/** Translation key of the name (the brand, the same in every language). */
	title: MessageKey;
	accent: string;
}

export const SITES: Record<ChatSite, SiteInfo> = {
	chatgpt: { id: "chatgpt", title: "chat.chatgpt", accent: "#10A37F" },
	gemini: { id: "gemini", title: "chat.gemini", accent: "#4F8DF7" },
};
