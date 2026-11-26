# `@deepseek-ai/dsh-desktop` (ZHarness desktop)

English | [中文](README.zh.md)

ZHarness is the macOS desktop app for DeepSeek Harness. It is an Electron shell that starts and supervises a `dsh web` server on a free `127.0.0.1` port, loads that Web UI in its window, and injects a desktop stylesheet and interaction enhancements. Agent capabilities, sessions, workspaces, model and permission settings all come from `dsh web`; the desktop app changes no harness package.

## Features

- **Supervised local server**: a start-up screen shows progress; when the server fails to start or exits unexpectedly, it shows the log tail with Retry and Open logs. Quitting sends SIGTERM, then SIGKILL after 5 seconds.
- **Desktop layout**: translucent sidebar (macOS vibrancy) with an inset rounded content card, hidden-inset title bar, blue-violet accent, light and dark themes.
- **Home screen**: a time-of-day greeting and quick-start task cards under the composer; without a workspace, a card first opens the workspace chooser and fills the task once one is selected.
- **Native menu and shortcuts**: ⌘N new task, ⌘L focus composer, ⌘\ toggle sidebar, ⌘, settings; the Help menu restarts the local server and opens the log and data directories.
- **Separate data directory**: desktop settings, API keys, and sessions live in `~/.zharness` (override with `ZHARNESS_DSH_HOME`), not the CLI's `~/.dsh`, because the two can be different releases and dsh rejects on-disk formats written by other releases.
- **Environment**: reads PATH from the login shell (plus Homebrew paths) so the agent's shell tools find commands installed by `brew`, `nvm`, and similar; external links open in the default browser.

## Run in development

```sh
pnpm install
pnpm run build                                  # repository root: build dsh packages and the frontend
pnpm --filter @deepseek-ai/dsh-desktop start    # compile the shell and launch Electron
```

Development runs use the workspace build of `@deepseek-ai/dsh` and the `node` on the login-shell PATH (Node.js 22.19+); `DSH_DESKTOP_NODE` selects another Node. The `dev` script also opens DevTools. If the Electron binary is missing, run `node apps/desktop/node_modules/electron/install.js`.

## Build the .dmg

Run on a Mac whose architecture matches the target (arm64 by default):

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac       # arm64 → apps/desktop/dist/*.dmg / *.zip
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac:x64   # x64, on an Intel Mac
```

Packaging steps:

1. `scripts/stage-runtime.mjs` runs `pnpm deploy` for `@deepseek-ai/dsh` into `.stage/dsh-runtime`, adds the peer dependencies and vendored packages that deploy omits, and replaces symlinks with copies.
2. `scripts/fetch-node.mjs` downloads the official Node.js build (SHA-256 verified) into `.stage/node/<arch>`. The dsh loader uses Node's internal ESM loader, which Electron's embedded Node (`ELECTRON_RUN_AS_NODE`) cannot run, so the app ships its own Node.
3. `electron-builder` packages the app; `scripts/after-pack.cjs` copies `.stage/dsh-runtime` into `Contents/Resources` because electron-builder never copies `node_modules` through `extraResources`.

The runtime includes host-native modules (node-pty, sharp, koffi), so staging and packaging must run on a Mac of the target architecture.

Builds are unsigned by default (internal distribution). Open an unsigned app the first time with right-click → Open, or run `xattr -dr com.apple.quarantine /Applications/ZHarness.app`. To sign and notarize, set `CSC_LINK`/`CSC_NAME` and remove `identity: null` from `electron-builder.yml`.

## Implementation

| File | Role |
|---|---|
| `src/main.ts` | Window, lifecycle, navigation fence (local server origin only; other links go to the default browser), single instance |
| `src/server.ts` | Free-port selection, `dsh web --host 127.0.0.1 --port <p>`, readiness from the `dsh web: <url>` line, log at `~/Library/Logs/ZHarness/dsh-web.log` |
| `src/runtime.ts` | Node and dsh entry resolution, login-shell PATH, child environment (`DSH_DESKTOP=1`) |
| `src/menu.ts` | Chinese application menu |
| `src/preload.cts` | Start-up screen bridge, home greeting and quick-start cards, menu commands that drive Web UI controls |
| `assets/desktop.css` | Desktop skin: `--dsw-alias-*` token overrides and layout |

The skin matches the readable suffix of CSS-module class names (for example `[class*="_newSession"]`) and `data-slot` attributes. Renaming those classes or slots in the Web UI requires a matching skin change.

## Known Limitations and Deferred Work

- macOS only; Windows and Linux run but have no dedicated styling or packaging.
- The skin depends on Web UI class-name suffixes and `data-slot` values, which are not a stable extension interface; a client `ui-*` plugin or theme registration should replace it.
- The quick-start cards are a fixed list.
- No auto-update or code signing.
