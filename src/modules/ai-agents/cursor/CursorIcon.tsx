import { MousePointer2Icon } from "lucide-react";
import { CURSOR_COLOR } from "./useCursor";

/** A plain pointer glyph (not Cursor's logo). */
export function CursorIcon({ size = 16 }: { size?: number }) {
	return <MousePointer2Icon size={size} color={CURSOR_COLOR} strokeWidth={2} />;
}
