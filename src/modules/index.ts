import type { IslandModule } from "../core/types";
import { activitiesModule } from "./activities";
import { aiAgentsModule } from "./ai-agents";
import { askModule } from "./ask";
import { chatgptModule, geminiModule } from "./chat";
import { clipboardModule } from "./clipboard";
import { clockModule } from "./clock";
import { dockerModule } from "./docker";
import { findModule } from "./find";
import { githubModule } from "./github";
import { hydrationModule } from "./hydration";
import { monitorModule } from "./monitor";
import { musicModule } from "./music";
import { notesModule } from "./notes";
import { notificationsModule } from "./notifications";
import { peripheralsModule } from "./peripherals";
import { shelfModule } from "./shelf";

/**
 * Every module the island knows about, in tab order.
 *
 * Each module is a self-contained folder (`src/modules/<name>/`) with its own
 * components, hooks and CSS, exporting an `IslandModule` (see `core/types.ts`).
 * If it needs data from the OS, add a matching provider in
 * `src-tauri/src/providers/<name>/`.
 */
export const modules: IslandModule[] = [
	musicModule,
	aiAgentsModule,
	askModule,
	chatgptModule,
	geminiModule,
	findModule,
	notificationsModule,
	activitiesModule,
	notesModule,
	shelfModule,
	clipboardModule,
	githubModule,
	dockerModule,
	hydrationModule,
	peripheralsModule,
	monitorModule,
	clockModule,
];
