![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

# Mim

The Operating System for AI-Native Research Organisations.

**Mim** is a malleable desktop app. It serves as a reusable Electron runtime for bespoke agentic applications and skills. It provides AI primitives, permission+audit layer, and UI mounting.

The app ships three integrated surfaces:

- **Chat** — streaming AI agent with tool use, approval gate, model/effort picker, cost tracking.
- **Document pane** — unified text/PDF/file-card tabs; text uses CodeMirror 6 with formatting, live preview, comments, citations, export, and ghost suggestions.
- **Terminal** — multi-tab shell (xterm.js + node-pty); detected CLI coding agents (Claude Code, Codex, Gemini CLI, Pi) launch as first-class agent sessions with working, completion, and input-required status, persisted scrollback, history, and access to Mim tools. Pi's tool bridge is built into Mim-launched sessions.

Apps extend the shell with custom UI mounted in sandboxed iframes, backed by a WebSocket SDK that gives them access to the full tool registry.

Core also provides local audit and recovery infrastructure: permissioned tool
execution, trace logging, and per-file local history under `.mim/` so important
workspace artifacts can be restored without Mim touching the user's `.git`
repository. Workspaces can also opt into managed git sync when a user wants Mim
to handle the ordinary save, pull, and push loop.

Agents can delegate long-running work to durable **subagents**. Each child has
its own session, transcript, model/tool loop, inherited permission lineage, and
Navigator status. Spawning is asynchronous; parents can wait, steer an active
turn, interrupt it, or send follow-up work into the same context. Wait timeouts
are long-poll heartbeats, not worker deadlines. See
[docs/subagents.md](docs/subagents.md).

Routines can also listen from Slack. A Slack bot mention activates a thread as
a normal Mim routine session; replies in that Slack thread continue the same
transcript without repeated mentions, and setup uses capability groups instead
of raw tool plumbing. See [docs/integrations.md](docs/integrations.md#slack).

Mim also has a headless kernel for local automation and a local `mim mcp`
stdio bridge that connects CLI agents to the running desktop app. Collaboration
uses ordinary local checkouts and Git rather than a network-hosted workspace.

Desktop-first. Local-first. File-based. Built with Electron + Vue 3 + Vercel AI SDK + CodeMirror 6.


## Quick Start

```bash
npm install
npm run build
npm run test
npm run dev
```

Headless CLI after build:

```bash
node bin/mim.mjs help
node bin/mim.mjs status --workspace .
```

## Release Builds

Release packaging is driven by `.github/workflows/release.yml` on `v*` tags or manual workflow dispatch. The matrix builds macOS arm64/x64, Windows x64, and Linux x64/arm64. macOS, Windows, and Linux AppImage builds support app auto-update through GitHub Releases metadata generated during packaging. Linux deb and tar.gz artifacts remain manual download formats; the tar.gz is the fuse-free portable option when AppImage support is missing.

## AI Key Setup

The key resolver checks, in order:
1. `~/.mim/keys.env` (app-managed — what Settings writes)
2. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`)

The app-managed file wins so keys set, replaced, or removed in Settings always take effect, even when a stale key is exported in the shell that launched the app. Keys can be set from the app via the `ai.setKey` tool and removed via `ai.clearKey`, both of which write `~/.mim/keys.env`. Settings > AI & Models shows each configured key as a masked tail (`ai.keyStatus` returns the fragment; the full key never leaves the main process) with Replace/Remove controls for file-stored keys; env-sourced keys show Replace only, since removing them means removing the variable from the shell that launches Mim. Key changes apply live to every AI surface (chat, inline rewrite, ghost, apps) with no app restart: `setKey`/`clearKey` emit `ai:keys-changed`, and the renderer caches key status reactively in the settings store.

`~/.mim/config.yaml` holds Personal identity, appearance/editor preferences,
model defaults, global skill activation, one credential-free Team repository,
and integration account labels. The writable Team checkout lives at
`~/.mim/team/` and uses system Git credentials. Personal config never holds API
keys or integration tokens. Project runtime state such as
transcripts, app enablement, routine activation, recovery, and traces remains
under the checkout's gitignored `.mim/`.


## Concepts

- **Mim** = product.
- Single window with Navigator, Work, and Artifact panes. The Navigator selects Work; Work opens durable Artifacts; app runs are Work,
  not launcher/config panels.
- Internal package name is `mim`.
- `localStorage` keys use `mim:` prefix.
- Workspace data lives in `~/mim-workspace/.mim/`.
- API keys live in `~/.mim/keys.env`.
- Integration tokens live in the OS keychain.
- On macOS, the main window's red close button hides Mim without stopping the
  app; clicking Mim in the Dock restores the same window. Use `Cmd+Q` or
  **Mim > Quit Mim** to quit and stop background work.

## Apps

User-facing apps live in [shoulders-ai/mim-apps](https://github.com/shoulders-ai/mim-apps), one per `packages/<id>/`. This repo is the core runtime — no built-in apps. Add apps to your sidebar with `app.add` in Settings > Apps; use `app.share` to commit a workspace app pin for collaborators. `package.install` is the lower-level cache/install tool, and installs land in `~/.mim/packages/<id>/<version>/`. Settings > Apps can also create workspace starter apps from templates, validating them before reload, then revealing the created folder. To develop, clone mim-apps and open it as a Mim workspace — edits show on reload. See the [mim-apps README](https://github.com/shoulders-ai/mim-apps) for publishing. App-root `README.md` files are auto-discovered as read-only documentation tabs.

For building workspace-specific capabilities, see [docs/custom-apps.md](docs/custom-apps.md).
