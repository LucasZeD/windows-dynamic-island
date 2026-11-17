import { ExternalLinkIcon, HouseIcon } from "lucide-react";
import { providerAction } from "../../../core/bridge";
import { useT } from "../../../core/i18n";
import { CHAT_PROVIDER, type ChatSite } from "../types";

const ICON_BUTTON = "grid size-6 place-items-center rounded-full text-text-dim hover:bg-white/10 hover:text-white";

/** Back to the site's start page, and the page in the browser. */
export function ChatTabBar({ site }: { site: ChatSite }) {
	const t = useT();
	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				className={ICON_BUTTON}
				title={t("chat.home")}
				onClick={() => providerAction(CHAT_PROVIDER, "home", site)}
			>
				<HouseIcon size={13} />
			</button>
			<button
				type="button"
				className={ICON_BUTTON}
				title={t("chat.external")}
				onClick={() => providerAction(CHAT_PROVIDER, "openExternal", site)}
			>
				<ExternalLinkIcon size={13} />
			</button>
		</div>
	);
}
