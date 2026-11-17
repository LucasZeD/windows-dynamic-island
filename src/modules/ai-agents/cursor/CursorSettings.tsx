import { Block, Row } from "../../../components/ui/card";
import { Chip, Chips } from "../../../components/ui/text";
import { useProvider } from "../../../core/bridge";
import { useT } from "../../../core/i18n";
import { type CursorState, PROVIDER } from "./useCursor";

/** Nothing to set up: says whether Cursor is installed and signed in. */
export function CursorSettings() {
	const state = useProvider<Pick<CursorState, "available" | "signedIn" | "plan">>(PROVIDER);
	const t = useT();

	const status = !state?.available
		? t("cursor.integration.missing")
		: state.signedIn
			? t("cursor.integration.found", { plan: state.plan ?? "?" })
			: t("cursor.integration.signedOut");

	return (
		<Block>
			<Row label={t("cursor.integration.title")} desc={t("cursor.integration.desc")} />
			<Chips>
				<Chip ok={!!state?.available && !!state.signedIn}>{status}</Chip>
			</Chips>
		</Block>
	);
}
