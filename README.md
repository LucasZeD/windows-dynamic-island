<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="112" alt="Dynamic Island icon" />

# Dynamic Island for Windows

An iPhone/macOS-style Dynamic Island for the top of your Windows desktop. It shows what's playing, what your AI coding agents are doing, your notifications and more, and stays out of the way the rest of the time.

[**Download the latest release (free)**](https://github.com/HeyyCzer/windows-dynamic-island/releases/latest)

<a href="https://get.microsoft.com/installer/download/9nxff6h0lpdl?referrer=appbadge" target="_self">
	<img src="https://get.microsoft.com/images/en-us%20light.svg" width="200" alt="Get it from Microsoft" />
</a>

The GitHub release is free. The Microsoft Store version is paid: buy it if you want to support the project.

<img src="docs/demo.gif" width="760" alt="The island in use: a WhatsApp message arrives, the next song starts, Claude Code asks to run a command, the volume changes, then the music and notifications tabs" />

</div>

## About this fork

This is a personal build of [HeyyCzer/windows-dynamic-island](https://github.com/HeyyCzer/windows-dynamic-island). It follows upstream (new upstream commits are merged in by hand) and adds the changes below. The download links above are upstream's releases, which don't include them: build this fork from source (see [Install](#install)). The full list is in the [changelog](CHANGELOG.md).

- **More AI chats:** ChatGPT and Gemini inside the island, signed in with your own account, next to Ask Claude.
- **More agents:** Cursor in the AI Agents tab (plan usage and tokens), alongside Claude Code and Codex.
- **Peripherals:** the battery of wireless mice, keyboards, headsets and controllers, read with [Halo Battery](https://github.com/HeyOkay/HaloBattery).
- **GitHub:** issues, pull requests, stars, the latest release and commit of each repo, a chosen branch per repo, and a toast on new releases or pushes.
- **Looks:** notch or island, dark / light / auto theme, solid, frosted or Liquid Glass, and a resting orb. The settings window follows the same look.
- **Notices:** speech bubbles by the orb and stacked toasts when a task finishes, with a choice of sounds and a volume setting.
- **No automatic updates:** upstream installs its releases silently on startup, which would replace this build. Only the manual check on the About page remains.
- **Security:** the local servers refuse requests from web pages, and Claude Code hook paths must point inside `~/.claude/projects`.

## Highlights

- 🤖 **Your Claude Code sessions, live.** Which session is working, which one is waiting for your permission, and how much of your plan you've used, without switching windows.
- 🔍 **Ctrl+F for the whole screen.** **Ctrl+Alt+F** finds any text on your monitors, even inside pictures, highlights every match and takes the mouse to each one.
- 🎵 **Music from any player.** Spotify, browsers, Apple Music: track, artwork, controls and a visualizer. A YouTube video plays muted right in the island, and **Pin** pops it out into a small floating window.
- 💬 **Ask Claude from anywhere.** Press **Ctrl+Alt+Space** and type. It uses your Claude Code login, so no API key is needed, and it can attach a screenshot of the window you were in.
- 🧩 **As many modules as you want, without clutter.** The modules you pin sit in the tab bar and the rest are one click away in the launcher. Drag to reorder them or turn them off.
- 🎨 **Two looks with lots of options.** It can be a plain black notch or a floating pill with a gradient rim. See [Make it yours](#make-it-yours).
- 🪶 **Stays out of the way.** It hides during fullscreen games and videos, expands on hover, and the mouse wheel flips through the tabs. Click the tray icon and it falls into a black hole until you call it back.

<p align="center">
  <img src="docs/screenshots/agents.png" width="620" alt="AI Agents panel: plan limits, tokens today, 7-day chart and live sessions" />
</p>

## Make it yours

Not into the colorful look? You don't have to use it. **Settings → Appearance** has four parts:

- **Style**: the **notch** (default), hanging from the top edge with named tabs, or the **island**, floating below the edge. At rest the island is a small orb (its news pops up in speech bubbles) or a pill with the time; its tabs can sit at the top or the bottom.
- **Theme**: dark, light, or auto (follows Windows' app mode).
- **Material**: solid, frosted glass (the desktop blurred behind it) or Liquid Glass (clearer glass that catches the light), clear or tinted.
- **Border** (island only): a subtle hairline, a single gray, a preset gradient (Apple Intelligence, Aurora, Sunset, Ocean, Claude, Neon, Mono) or two colors of your own. You can pick a thin, medium or thick rim, and turn the moving gradient and the glow on or off.

The settings window takes on the same theme and material. **Preview** shows a sample bubble and toast.

<table align="center">
  <tr>
    <td align="center"><img src="docs/screenshots/look-dynamic.png" width="380" alt="Dynamic Island style" /><br /><sub>Dynamic Island</sub></td>
    <td align="center"><img src="docs/screenshots/look-windows-classic.png" width="380" alt="Windows Island with the classic hairline" /><br /><sub>Windows Island · classic</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/look-windows-mono.png" width="380" alt="Windows Island with a thin mono rim" /><br /><sub>Windows Island · thin mono</sub></td>
    <td align="center"><img src="docs/screenshots/look-windows-aurora.png" width="380" alt="Windows Island with the Aurora gradient and glow" /><br /><sub>Windows Island · Aurora + glow</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/look-frosted-dark.png" width="380" alt="The island in the dark theme with frosted glass, open on the AI Agents tab" /><br /><sub>Dark · frosted glass</sub></td>
    <td align="center"><img src="docs/screenshots/look-liquid-light.png" width="380" alt="The island in the light theme with Liquid Glass, open on the AI Agents tab" /><br /><sub>Light · Liquid Glass</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/windows.png" width="560" alt="Windows Island style, expanded on the music player with the Apple Intelligence rim" />
  <br />
  <img src="docs/screenshots/settings-appearance.png" width="560" alt="Appearance settings: style, border presets, thickness" />
</p>

## Features

**Music**: works with Spotify and anything that shows up in Windows' media controls (browsers, Apple Music, VLC…).

- Current track and artist right in the compact island
- Album art, title, artist and a live progress bar you can click to seek
- Play/pause, previous and next
- Audio visualizer that follows the music
- YouTube in a browser: the video itself plays in the island (muted, in sync with the tab), and **Pin** moves it to a small always-on-top window you can drag anywhere (it snaps to edges, scroll to resize)

<p align="center">
  <img src="docs/screenshots/compact-music.png" width="480" alt="Compact island showing the current track and artist" />
  <br />
  <img src="docs/screenshots/music.png" width="620" alt="Expanded music panel" />
</p>

**AI Agents**: live status of your [Claude Code](https://claude.com/claude-code) sessions.

- What each session is doing right now (editing a file, running a command, waiting for permission…), with a turn timer
- Each session shows its last prompt, so two sessions in the same project are easy to tell apart
- Plan usage limits (5-hour session and weekly) with reset countdowns
- Tokens and responses today, plus a 7-day chart and the last 5 hours from the local transcripts
- Optionally pops open when an agent needs you, finishes (showing how its reply starts) or your limits reset
- **Answer permission requests right in the island**: see the command, file or URL, then Allow, Always allow (the rule Claude Code suggests) or Deny. Answering in the terminal or VS Code keeps working, and the island's request goes away
- Click a session to open its project in VS Code
- Also shows Codex sessions, and the plan usage of Cursor and Antigravity
- When a session finishes, a toast drops below the island (one per session, stacking up) with a short sound

<p align="center">
  <img src="docs/screenshots/bubble.png" width="174" alt="Resting orb with a speech bubble: Claude Code is thinking" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/toasts.png" width="290" alt="Stacked toasts below the orb: a Claude Code session finished" />
</p>

**Ask Claude**: a conversation with Claude right in the island, using your Claude Code login (no API key).

- **Ctrl+Alt+Space** opens it from anywhere (Ctrl+Shift+Space if another app took it); **Esc** gives the keyboard back
- The answer streams in; if you leave, the island tells you when Claude answered
- 📷 attaches a screenshot of the window you were using; files dropped on it (or sent from the shelf) become attachments
- Runs `claude -p` headless with hooks off, so these chats don't show up as sessions. Read-only tools and web search work; for edits it suggests opening Claude Code

**ChatGPT and Gemini**: the sites themselves inside the island, signed in with your own account (your chat plan, not an API key). They sit next to Ask Claude at the end of the tab bar, as one switch. The panel size can be changed (480 × 960 by default), and a click outside closes it.

**Find on screen**: like a browser's Ctrl+F, for the whole screen. Press **Ctrl+Alt+F** anywhere (or open it from the launcher) and type.

- Reads everything on every monitor with Windows' own text recognition, so text inside pictures, videos and apps that don't let you search counts too
- Every match is highlighted, the current one in orange; **Enter** takes the mouse to the next one (**Shift+Enter** goes back), ready to click
- Ignores case and accents, and finds phrases across words. **↻** reads the screen again if it changed; **Esc** clears everything
- Runs offline. The screen is read when you start a search and is kept in memory only while the search is open

**Launcher and tabs**: the grid button in the tab bar opens every module as a tile. Every module's settings are listed under **Modules** in the settings sidebar. In **Settings → Modules** you can drag modules to reorder the tabs, choose which ones sit in the tab bar and which stay in the launcher, and turn them on or off. A busy module shows up in the bar even when it isn't pinned, and the island reopens on the last tab you used if you come back within a few minutes.

<p align="center">
  <img src="docs/screenshots/launcher.png" width="560" alt="Launcher with every module as a tile" />
</p>

**Clock & calendar**: the time, a month calendar (scroll or use the arrows to change months), the week number, and how far away a day is when you click it.

<p align="center">
  <img src="docs/screenshots/calendar.png" width="560" alt="Clock and month calendar" />
</p>

**Shelf**: drag files or folders onto the island and it keeps them (by reference) until you drag them out to another app. Double-click opens a file, and 💬 asks Claude about it.

<p align="center">
  <img src="docs/screenshots/shelf.png" width="560" alt="Shelf holding a PDF, a folder and a picture" />
</p>

**Clipboard**: what you copy (text, pictures, files) shows up in the island for a moment, and the last 20 items stay in a list.

- Screenshots (Win+Shift+S, Print Screen, ShareX, Greenshot…) open the island with the picture
- Click an item to copy it again; drag pictures and files out to any app; 💬 asks Claude about it; 📁 keeps it on the shelf (pictures are saved to *Pictures\Screenshots*, reusing the file Snipping Tool saved if there is one)
- Text is only kept in memory, and what password managers copy is never read

**Notifications**: WhatsApp, Teams, Outlook, Discord and other apps' notifications, mirrored from Windows. Each new one pops open with the app's icon, and the tab keeps the recent ones (click one to open its app). Windows only lets registered apps read notifications, so **Settings → Modules → Notifications → Enable** registers the island once as a sparse package and restarts it. This needs Windows Developer Mode, since the registration isn't signed.

**GitHub**: the repositories you follow, yours or anyone's.

- A side bubble next to the island with the total of open issues
- A panel with each repo's open issues, pull requests and stars; each repo unfolds into forks, language, last push, the latest release, commit and issue, with links
- A toast when a repo publishes a release, and optionally on each push
- Each repo can follow a branch other than its default one for commits; drag repos to reorder them in the settings
- Optionally pops open when someone opens a new issue
- Works anonymously for public repos (details then refresh every 30 minutes); uses your GitHub CLI login automatically, or a token kept in the Windows Credential Manager for private repos

<p align="center">
  <img src="docs/screenshots/github.png" width="580" alt="GitHub panel: a repository unfolded into stars, forks, language, latest release, commit and issue" />
</p>

**System monitor**: CPU, memory, GPU and network with a chart of the last minute, measured like Task Manager does.

- Values slide from green to red as usage climbs
- Optional side bubble with the CPU use and a memory dot
- Warns when the CPU or the memory stays maxed out for 30 seconds, naming the app behind it

**Peripherals**: the battery of wireless mice, keyboards, headsets and controllers (30+ brands, among them Razer, Logitech, SteelSeries, HyperX, Corsair, ASUS ROG, Sony, Xbox, Nintendo and 8BitDo), read by [Halo Battery](https://github.com/HeyOkay/HaloBattery)'s device code. Levels use the system monitor's colors (red at the device's alert level), with alerts when a device runs low or is fully charged. Windows only, and only in builds made with `bun run app:build:personal`.

<p align="center">
  <img src="docs/screenshots/peripherals.png" width="558" alt="Peripherals panel: a wireless mouse at 50% and a headset at 80%" />
</p>

**Sound**: **Settings → Sound** sets the volume of every sound the island plays and the sound for finished tasks (Chime, Sparkle, Marimba, Pop or Arcade, synthesized by the app). Every module's settings are listed under **Modules** in the sidebar.

<p align="center">
  <img src="docs/screenshots/settings-sound.png" width="620" alt="Sound settings: volume, the sound for finished tasks, and the modules listed in the sidebar" />
</p>

**Live Activities**: short alerts and ongoing activities:

- Volume level bar, charger plugged in/out and low battery (laptops only), Bluetooth headphones connecting (with their battery) and running low
- Anything a script or app sends through the [local API](#local-api) (downloads, timers, builds…)

**And also**

- Starts with Windows and lives in the tray; updates are checked only from the About page
- English, Portuguese (Brazil) and Chinese (Simplified), following your system language by default

<p align="center">
  <img src="docs/screenshots/settings.png" width="620" alt="Settings window, Modules page: reorder, tab bar or launcher, on/off" />
</p>

## Install

1. Grab `Dynamic.Island_<version>_x64-setup.exe` from the [latest release](https://github.com/HeyyCzer/windows-dynamic-island/releases/latest).
2. Run it — it installs for your user only, no admin prompt.

Or get it from the [Microsoft Store](https://get.microsoft.com/installer/download/9nxff6h0lpdl?referrer=appbadge) (paid, to support the project; updates come through the Store).

Requires Windows 10 or 11 (WebView2 is installed automatically if missing).

**This fork** has no releases: build it yourself (see [Development](#development)). `bun run app:build:personal` builds the peripherals helper and the app with it (it needs `git submodule update --init` once, and Python 3.12 or 3.13); `bun run app:build:local` builds without it. Run the resulting `src-tauri/target/release/bundle/nsis/*-setup.exe`.

### Claude Code integration

Open **Settings → Modules → AI Agents → Claude Code integration → Enable**. This adds HTTP hooks (live status) and a statusline bridge to `~/.claude/settings.json`; a backup is written before every change, and your existing statusline keeps working. Restart Claude Code sessions that were already open. Without it, the island still picks up sessions from Claude Code's transcripts, just with less detail.

The permission hook waits up to 10 minutes for your answer in the island (the other hooks give up after 3 seconds). If the integration was enabled by an older version, the AI Agents panel offers **Update integration**. Answering permission requests in the island can be turned off in the module's settings.

<p align="center">
  <img src="docs/screenshots/settings-agents.png" width="640" alt="AI Agents settings with the Claude Code integration enabled" />
</p>

**Plan limits** come from the statusline when you use the terminal CLI. Since the statusline doesn't run in the IDE extensions, the island also asks Anthropic directly, using the same endpoint as Claude Code's `/usage`. It authenticates with the OAuth token Claude Code keeps in `~/.claude/.credentials.json`, and that token is only ever sent to `api.anthropic.com`. Requests only happen while the panel is open (at most once a minute) or every few minutes while agents are active.

## Local API

The island listens on `http://127.0.0.1:5199` (localhost only; set `DYNAMIC_ISLAND_PORT` to change it). It's the same API as [Windows Island](https://github.com/PedroRuedas/Windows-Island), so its scripts work unchanged.

| Route | What it does |
| --- | --- |
| `POST /notify` | Alert: pops open and goes away after 5 s (default) |
| `POST /activity` | Live activity: stays until removed or until `duration` runs out. Send the same `id` again to update it |
| `DELETE /activity/{id}` | Removes an activity |
| `GET /status` | Current activities and media (never the content of mirrored notifications) |
| `POST /claude/hook` | Raw Claude Code hook payload (answers `204`) |

JSON fields (all optional, but send `title` or `progress`): `id`, `title`, `subtitle`, `icon` (`bell` `chat` `mail` `call` `download` `upload` `timer` `clock` `calendar` `check` `error` `warning` `info` `code` `sync` `heart` `star` `mic` `camera` `location` `wifi` `bluetooth` `music` `volume` `battery` `charging` `headphones` `folder`, or one character), `color` (`#RRGGBB`), `progress` (0–1), `duration` (seconds), `priority` (0–99, default 50), `action` (an `http(s)` link opened on click), `style` (`"level"` for a level bar) and `expand` (default `true` on `/notify`).

```sh
curl -X POST http://127.0.0.1:5199/notify -H "Content-Type: application/json" \
  -d '{"title":"Deploy done","subtitle":"api v2.3 in production","icon":"check","color":"#30D158"}'
```

Clients for [PowerShell](examples/powershell/DynamicIsland.psm1) (with a [demo](examples/powershell/demo.ps1)), [Python](examples/python/island.py) and [Node](examples/node/island.mjs) are in `examples/`.

## Development

You need [Bun](https://bun.sh) and [Rust](https://rustup.rs) (the version is pinned in `src-tauri/rust-toolchain.toml`).

```sh
bun install
bun run app:dev      # the real app, with hot reload
bun run app:build    # installers in src-tauri/target/release/bundle/
```

`bun run dev` serves the UI alone at http://localhost:1420 with fake data (`src/core/mock.ts`), handy for design work in a normal browser. Add `#settings` to the URL for the settings window, or `#pip` for the pinned video.

### Project layout

```
src/
  core/        island state, provider bridge, settings, appearance, i18n
  modules/     one folder per module (music, ai-agents, ask, chat, find, notifications, activities, shelf,
               clipboard, github, monitor, peripherals, clock), each with its own UI and settings
  locales/     translations (*.json5)
  settings/    settings window
  pip/         pinned YouTube video window
src-tauri/src/
  providers/   OS-side data sources, one per module (media controls, Claude Code, GitHub, local API + volume,
               battery and Bluetooth, Windows notifications, `claude -p` chat, screen text (OCR), shelf, clipboard history,
               performance counters, ChatGPT / Gemini pages, Cursor usage, peripheral batteries)
  sound.rs     alert sounds, and the finished-task tones it synthesizes
sidecars/peripherals/
               Halo Battery (submodule) and the bridge that runs it headless
  window.rs    click-through overlay window (no caption buttons) + hover hit-testing
  tray.rs      tray menu and black hole
  pip.rs       pinned video window
```

### Adding a language

Copy `src/locales/en.json5` to `src/locales/<code>.json5` (e.g. `es.json5`), translate the values and set `language.name`. That's it — both the UI and the tray pick it up automatically.

### Releasing

```sh
bun run v patch            # bumps package.json, commits and tags vX.Y.Z
git push --follow-tags
```

The tag triggers [the release workflow](.github/workflows/release.yml), which builds the installers and publishes them as a GitHub release.

## Acknowledgements

This project is based on [Vorssaint](https://vorssaint.com).

## License

Copyright © HeyyCzer. Licensed under the [GNU General Public License v3.0](LICENSE) or later.
