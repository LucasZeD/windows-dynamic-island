# Changelog

Changes in this fork relative to upstream ([HeyyCzer/windows-dynamic-island](https://github.com/HeyyCzer/windows-dynamic-island)).
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Upstream's own changes are in its
[releases](https://github.com/HeyyCzer/windows-dynamic-island/releases).

## [Unreleased]

Based on upstream 0.5.0, including its dependency updates up to 2026-11-17.

### Added

- Notes module, a small Obsidian in the island: a folder of Markdown files (`Documents/Island Notes` by
  default, changeable in its settings) shown as a tree (create, rename, drag to move, delete to `.trash`),
  notes open in tabs and save as you type. Live preview like Obsidian/Notion: the Markdown is drawn except on
  the line being edited (headings, bold, checkboxes, quotes, code, links). Web links, `[[wiki links]]` to other
  notes, and pictures pasted with Ctrl+V, saved in `attachments/`, which unfold in the note and open full size.
- ChatGPT and Gemini modules: the sites inside the island, signed in with the user's own account. The panel
  size is configurable (480 × 960 by default) and the page steps aside while the island is dragged.
- The Ask chats (Claude, ChatGPT, Gemini) are grouped as one switch at the end of the tab bar.
- Cursor in the AI Agents module: plan usage and tokens, read with Cursor's own sign-in.
- Peripherals module: battery levels of wireless mice, keyboards, headsets and controllers, through
  [Halo Battery](https://github.com/HeyOkay/HaloBattery) (MIT, included as a submodule), with low-battery and
  fully-charged alerts. Built by `bun run app:build:personal`.
- Appearance in four parts: style (notch or island), theme (dark, light, auto), material (solid, frosted
  glass, Liquid Glass, clear or tinted) and border. The island can rest as an orb.
- The settings window follows the island's theme and material, is resizable and remembers its size.
- Notices: a speech bubble by the orb for module news, and toasts when something finishes (a drop from the
  notch). Toasts stack, newest in front; each finished AI agent session gets its own.
- Settings → Sound: volume for every sound the app plays, and a choice of five synthesized sounds for
  finished tasks.
- Settings → Appearance → Preview: a sample bubble and toast.
- Every module is listed under Modules in the settings sidebar.
- GitHub module:
  - open pull requests and stars per repository; each repository unfolds into forks, language, last push,
    the latest release, commit and issue, with links;
  - a toast when a repository publishes a release, and optionally on each push;
  - a branch per repository for commits;
  - repositories can be reordered in the settings.
- The resting island steps aside from the caption buttons of the window in front.

### Changed

- System monitor values and peripheral battery levels slide from green to red.
- The finished-task sound setting moved from Appearance to Sound.
- Without a GitHub login, repository details refresh every 30 minutes to stay under the anonymous rate limit.

### Removed

- The automatic update check on startup, which installed upstream releases silently and would replace this
  build. The manual check on the About page remains.

### Fixed

- Form buttons (GitHub repository and token, Calendar, Spotify) did nothing when clicked.
- The island could stay in a drag after a lost mouse release; the chat's mouse hook could swallow the next
  release on the island.
- The GitHub repository list in the island did not scroll: the mouse wheel switched tabs instead.

### Security

- The local HTTP servers (activities API on port 5199, Claude Code hooks on port 47823) refuse requests with
  an `Origin` header or a non-local `Host`, which blocks web pages (CSRF) and DNS rebinding.
- Claude Code hook `transcript_path` values must resolve inside `~/.claude/projects`; network paths could
  leak the user's NTLM hash.
