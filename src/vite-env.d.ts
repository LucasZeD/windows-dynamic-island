/// <reference types="vite/client" />

/** `version` from package.json, injected by vite.config.ts. */
declare const __APP_VERSION__: string;

/** The commit this build was made from, injected by vite.config.ts (null outside a git checkout). */
declare const __APP_BUILD__: { commit: string | null; branch: string | null; dirty: boolean; date: string };

/** Locale files, flattened to `{ "dotted.key": "text" }` by vite-plugin-locales. */
declare module "*.json5" {
	const messages: Record<string, string>;
	export default messages;
}
