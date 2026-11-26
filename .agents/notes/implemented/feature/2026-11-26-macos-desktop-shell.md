# Agent Note: macOS desktop shell over the Web UI

Status: implemented

English | [中文](2026-11-26-macos-desktop-shell.zh.md)

## Problem

Internal users want DeepSeek Harness as a macOS desktop app with a workbench-style layout: a sidebar of tasks, a greeting and quick-start tasks on the home screen, and native window chrome and menus. The Web UI already provides sessions, workspaces, model setup, approvals, and settings, and every agent capability runs behind `dsh web`.

## Decision

**`apps/desktop` is an Electron shell over an unmodified `dsh web` process.** The main process starts `dsh web --host 127.0.0.1 --port <free port>` as a child process, treats the `dsh web: <url>` stdout line as readiness, and loads that URL. No harness package changes; the server keeps its own trust fence, settings, and credentials.

**The server runs on a real Node.js binary, never on Electron's embedded Node.** The Cordis loader resolves plugins through Node's internal ESM loader; under `ELECTRON_RUN_AS_NODE` plugin imports fail to resolve. Development runs use the login-shell `node`; packaged apps carry an official Node build fetched with checksum verification.

**The packaged runtime is a `pnpm deploy` of `@deepseek-ai/dsh` completed by a closure walk.** `pnpm deploy --legacy` omits peer dependencies and the `link:` vendored overrides, so `scripts/stage-runtime.mjs` copies every missing dependency or peer from its workspace or resolved location until the closure is complete, and dereferences links. `scripts/after-pack.cjs` places it in `Contents/Resources` because electron-builder drops `node_modules` from `extraResources`.

**Desktop styling is an injected stylesheet plus a preload script.** `assets/desktop.css` overrides `--dsw-alias-*` tokens with `!important` (ui-layout writes them inline on `<body>`) and restyles the frame; the preload adds the greeting, quick-start cards, the drag strip, and menu commands that click existing Web UI controls.

## Alternatives considered

**A new renderer over the JSON-RPC SDK.** Rejected for the first version: it would duplicate the session, approval, settings, and onboarding UI that the Web UI already owns.

**A client `ui-*` plugin in the Web UI roster.** Deferred: it is the stable extension route for the home-screen cards and theme, but it requires a desktop-specific bundle patch and frontend build integration.

**Electron's embedded Node via `ELECTRON_RUN_AS_NODE`.** Rejected because the loader fails to resolve plugins there (see Decision).

## Consequences

The desktop app tracks Web UI behavior without code changes. The skin depends on CSS-module class-name suffixes and `data-slot` values that are not a stable interface, so Web UI renames can break styling silently; the [package README](../../../../apps/desktop/README.md) records this limitation. Packaging must run on a Mac of the target architecture because the runtime carries host-native modules.
