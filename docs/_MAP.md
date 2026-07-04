# _MAP.md — Codebase Navigation Map

Start here when changing the codebase. This is a navigation index, not a design doc.

## Read This First

- This is an Electron app. Main process is Node.js. Renderer is Vue 3 + Pinia.
- [gotchas.md](gotchas.md) — non-obvious constraints. Add to it when a fix depends on a subtle rule.
- [security.md](security.md) — permission/trust model. Read before changing `gate.ts` or approval flow.
- [design-system.md](design-system.md) — visual language, tokens, interaction rules. Read before UI work.

## Quick Start

```bash
npm install && npm run build && npm run test
npm run dev                        # launch app
npm run test:packages:compat       # cross-repo app contract tests
```

## Architecture Overview

```
Electron App
  Main Process (Node.js)
    Boot (index.ts) → Tool Registry → Trace Log → Search DB → Server
    ├─ agents/        CLI agent catalog, session lifecycle, pty status tracker
    ├─ ai/            model registry, runtime, agent context, system prompt
    ├─ packages/      loader, manifests, enablement, runtime, jobs, data, HTTP, secrets
    ├─ comments/      inline comment models (markdown tags, code @mim markers) + path dispatch
    ├─ resources/     shared resource collection model
    ├─ search/        SQLite FTS, file content search, text matching
    ├─ security/      permission gate and path classifier
    ├─ server/        Express + WebSocket for apps/AI/MCP
    ├─ workspace/     boot, mim.yaml contract, file watcher
    ├─ tools/         registry + all tool modules
    ├─ integrations/  Slack, Google, keychain secrets, HTTP boundary
    ├─ trace/         unified trace stream: spans, identity, audit, blobs
    ├─ sessions.ts    chat session CRUD, JSON file storage
    ├─ pty.ts         terminal spawning (node-pty, shared with agent sessions)
    ├─ skills.ts      filesystem SKILL.md loader
    └─ headless.ts    non-Electron CLI registry

  Preload (preload/index.ts)
    window.kernel.call() ↔ ipcRenderer.invoke()

  Renderer (Vue 3 + Pinia)
    App.vue + services/appShell/    Navigator / Work / Artifact shell
    ├─ ChatView                     AI SDK Chat + DefaultChatTransport
    ├─ EditorPanel                  unified document tabs (CodeMirror, PDF, table, file cards)
    ├─ TerminalPanel                xterm.js + pty IPC
    ├─ Workbench store              pane history, layout invariants, command path
    ├─ Runs store                   chat/app/agent session aggregation
    └─ Workbench components         NavigatorPane, WorkPane, ArtifactPane, hosts

  App Iframes
    runtime.call() → SDK WebSocket → Server → Tool Registry
```

## Systems

Each entry is a one-liner with the source cluster and relevant docs. Read the linked files for implementation detail.

### Main Process — Core

- **Electron shell.** App lifecycle, window creation, IPC, quit guard. `src/main/index.ts`, `closeGuard.ts`, `platform.ts`, `menu.ts`.
- **Tool registry.** Universal dispatch with actor context and trace logging. `src/main/tools/registry.ts`.
- **Permission gate.** Approval policy for AI/app tool calls, keyed on effect (read/mutate/external). `src/main/security/gate.ts`, `gate-paths.ts`. Docs: [security.md](security.md).
- **File tools.** read/write/edit/create/delete/list/rename/copy/trash, workspace-scoped, stale-write protection via content hashes. `src/main/tools/fs.ts`, `workspaceFileWatcher.ts`.
- **Local file history.** Per-file recovery under `.mim/history/`, independent of git, with bounded automatic baselines. `src/main/history/`, `tools/history.ts`. UI: `HistoryRail.vue`. Docs: [history.md](history.md).
- **Sessions.** Chat session CRUD, atomic JSON in `.mim/sessions/`, manifest cache. `src/main/sessions.ts`, `sessionManifest.ts`.
- **Workspace.** Boot (restore last or create default), `mim.yaml` contract (schema, init detection, scaffold), scoped open-file watcher. `src/main/workspace/`. Docs: [git.md](git.md) for sync.
- **Git tools.** Status/diff/log/commit/pull/push and opt-in managed sync. `src/main/git.ts`, `tools/git.ts`, `tools/sync.ts`.
- **User-global config.** `~/.mim/config.yaml` (identity, model defaults, skill sources). Never holds keys or tokens. `src/main/userConfig.ts`.
- **Settings tools.** Workspace settings persistence in `.mim/settings.json`; agent tool availability policy for Settings > Tools. `src/main/tools/settings.ts`, `src/main/tools/toolPolicy.ts`.
- **Bridge tools.** Cross-surface messaging: `editor.open`, `terminal.run`, `chat.send`. `src/main/tools/bridge.ts`.
- **Editor state tool.** `editor.state` (MCP: `editor_state`): open tabs + active document snapshot, pushed by the renderer and cached in main. `src/main/tools/editorState.ts`.
- **Headless CLI.** `mim` command over the shared tool registry; no Electron. `src/main/cli.ts`, `headless.ts`. Docs: [cli.md](cli.md).
- **MCP bridge.** Stdio bridge from external CLI agents to the running desktop. `src/main/mcp/`. Docs: [mcp.md](mcp.md).
- **Preload bridge.** `window.kernel` IPC gateway. `src/preload/index.ts`.

### Main Process — AI

- **Model registry.** Model catalog, key resolution (env → `~/.mim/keys.env`), model-default cascade. `src/main/ai/ai.ts`, `resources/ai-models.json`.
- **AI runtime.** Vercel AI SDK provider calls, ToolLoopAgent profiles, ghost generation, tool wrapping, usage/context tracking, and browser-tool message compaction. `src/main/ai/aiRuntime.ts`, `src/main/ai/messageCompaction.ts`.
- **System prompt.** Template-based from `AGENTS.md` with `{{TOOL_SET}}`, `{{SKILL_CATALOG}}`, `{{WORKSPACE_TREE}}`, `{{PROJECT_LOG}}` etc. `src/main/ai/systemPrompt.ts`, `workspaceTree.ts`.
- **Agent context.** Deterministic `.mim/agent-context.md` digest with workspace/app/git health. `src/main/ai/agentContext.ts`, `packages/packageContributions.ts`.

### Main Process — Execution & Terminal

- **Toolchain detection.** Catalog of R/Rscript/Quarto/pandoc/python3 with login-shell binary resolution, version capture, and promise cache. `src/main/toolchain/toolchain.ts`. Docs: [code-execution.md](code-execution.md).
- **Code execution.** `code.run` tool: allowlisted interpreter spawn, output tail caps, product scan, run records, plot-capture harness. `src/main/tools/code.ts`, `resources/r/mim-run.R`. Docs: [code-execution.md](code-execution.md).
- **Terminal (PTY).** node-pty spawning, shell integration, keybinding profiles, program tabs (toolchain-validated). `src/main/pty.ts`, `ptyCommand.ts`, `ptyShellIntegration.ts`.
- **Agent sessions.** CLI coding agents (Claude Code, Codex, Gemini CLI) as first-class runs with status tracking. `src/main/agents/`. Docs: [agent-sessions.md](agent-sessions.md).

### Main Process — Web & Content

- **Web tools.** `web.search` (Exa), `web.read` (simple stateless/PDF reader), `web.live.open`, and `web.live.act` (Markanywhere-port live browser with bounded observations and compact action refs). MCP exposes these as `web_search`, `web_read`, `browser_open`, and `browser_act`. `src/main/web/`, `tools/web.ts`. Docs: [web-reading.md](web-reading.md).
- **HTML-to-Markdown.** Pure parser shared by web readers and DOCX extraction. `src/main/html/markdown.ts`. Docs: [html-markdown.md](html-markdown.md).
- **Document import.** DOCX/XLSX/BibTeX/PDF → Markdown. `src/main/documents/importMarkdown.ts`, `tools/documents.ts`.
- **Document export.** Markdown → PDF (Chromium `printToPDF`) and → DOCX (pure JS). `src/main/export/`, `tools/export.ts`. Docs: [export.md](export.md).
- **Slides render.** `render.htmlToPdf` core tool with layout validation. `src/main/tools/render.ts`, `htmlPdf.ts`.
- **DOCX review.** Main-process read/annotate tools plus .NET sidecar. `src/main/docx/`, `tools/documents.ts`, `sidecar/docx-worker/`. Docs: [docx-review-workflow.md](docx-review-workflow.md).
- **References.** BibTeX parsing, bibliography resolution, citeproc export. `src/main/tools/references.ts`, `export/citations.ts`.
- **Inline comments.** `<comment>`/`<note>` tags in markdown, `@mim` line markers in code files; parser/tools/CM6 extension/review rail. `src/main/comments/`, `tools/comments.ts`.
- **Logbook.** Optional `.mim/log.md` activity log, `{{PROJECT_LOG}}` in system prompt. `src/main/logbook.ts`, `tools/logbook.ts`. Docs: [logbook.md](logbook.md).

### Main Process — App System

- **App loader.** Workspace > global precedence, version pins, manifest validation. `src/main/packages/packages.ts`, `packageManifest.ts`, `packageEnablement.ts`.
- **App runtime.** Backend jobs, app data, `ctx.http` (host allowlist), `ctx.secrets` (keychain), named tools. `src/main/packages/packageRuntime.ts`, `packageJobs.ts`, `packageData.ts`, `packageHttp.ts`, `packageSecrets.ts`, `namedPackageTools.ts`. Docs: [app-system-api.md](app-system-api.md).
- **Registry & install.** Multi-source resolution with ownership rule, trust gating, archive/git/local installs, and active-workspace package update checks. `src/main/packages/registrySources.ts`, `registryIndex.ts`, `updateCheck.ts`, `tools/registryTools.ts`, `tools/install.ts`. Docs: [private-registry.md](private-registry.md) for the authenticated account registry.
- **Core-app tools.** `app.status/enable/disable/remove/trust` for personal enablement. `src/main/tools/coreApps.ts`.
- **App authoring.** Starter templates, create/validate/reload authoring loop. `src/main/tools/packages.ts`, `templates/appTemplates.ts`.
- **App server.** Express + WebSocket, SDK file serving, app/MCP tool dispatch. `src/main/server/server.ts`.
- **App SDK.** WebSocket client for iframes. `sdk/mim.js`, `sdk/tokens.css`.
- **Skills.** Filesystem `SKILL.md` loader, authored + app-bundled skills, progressive tool gating. `src/main/skills.ts`, `tools/skills.ts`. Docs: [skills.md](skills.md), [custom-apps.md](custom-apps.md).

### Main Process — Integrations

- **Slack & Google.** Keychain-backed connectors, Google browser OAuth, kernel tools, AI tool builders, and Settings > Tools availability policy. Data tools are exposed over MCP when connected and enabled. AI agent can manage connection lifecycle (connect, disconnect, configure policy) via `connections_status`, `google_set_oauth_client`, `google_connect`, `slack_connect`, `connections_configure` tools. File-based credential ingestion reads secrets server-side so they never enter model context. `src/main/integrations/`, `src/main/tools/toolPolicy.ts`. Docs: [integrations.md](integrations.md).
- **Account tokens.** Org registry token management in `~/.mim/keys.env`. `src/main/tools/account.ts`.

### Main Process — Observability

- **Trace stream.** Unified audit + observability, span-tree JSONL day files, payload blobs, outcome tracking. `src/main/trace/`, `tools/trace.ts`. Docs: [observability.md](observability.md).
- **Telemetry.** Anonymous usage telemetry, redacted trace-sink projection. `src/main/telemetry/`, `tools/telemetry.ts`. Docs: [telemetry.md](telemetry.md).
- **Search.** SQLite FTS5 for sessions, async file content walker. `src/main/search/`.

### Renderer — Surfaces

- **Chat.** AI SDK Chat + DefaultChatTransport, message rendering, composer with @mentions and context chips, inline approval cards, code-run card. `src/renderer/components/chat/`, `services/ai/`, `stores/approvals.ts`, `components/chat/ChatCodeRunCard.vue`.
- **Editor / Document pane.** Unified tab host: CodeMirror text, PDF viewer, table grid (AG Grid), file cards. Autosave, conflict bar, per-tab scroll restore, inline AI (Cmd+K), diff review, comments rail, citations, ghost completions. `src/renderer/components/editor/`. Docs: [document-pane.md](document-pane.md), [comments.md](comments.md).
- **CodeMirror extensions.** Setup, formatting, citations, outline, ghost, live preview, inline anchor, send-to-terminal (Cmd+Enter / chunk send). `src/renderer/components/editor/codemirror/`.
- **Terminal.** xterm.js multi-tab shells, TerminalSurface shared with agent sessions. `src/renderer/components/terminal/`.
- **Files.** Work-side file browser: Browse/Recent/Changed, search, drag-drop import/move, context menus, passive active-document marker, image artifact viewer. `src/renderer/components/files/`, `services/fileOpenPolicy.ts`, `components/files/ImageArtifact.vue`.
- **History.** Browse active/archived sessions, app runs, agent sessions. `src/renderer/components/archive/`.
- **Agent sessions.** Work surface for live terminal or scrollback replay. `src/renderer/components/agents/AgentSessionView.vue`.

### Renderer — Shell & Navigation

- **Sidebar / Navigator.** Workspace switcher, fixed surface rows (Chat/Files/Terminal/Monitor), collapsible Apps + Activity sections, 52px collapsed rail. `src/renderer/components/sidebar/`.
- **Workbench state.** Work/Artifact entries, pane history, layout invariants, dirty replacement guard. `src/renderer/stores/workbench.ts`, `services/workbench/`. Docs: [workbench-navigation.md](workbench-navigation.md), [workbench-layout.md](workbench-layout.md).
- **App shell.** Composition shell, tested adapters for routing/lifecycle/keyboard. `src/renderer/App.vue`, `services/appShell/`, `components/workbench/`.
- **Command palette.** Cmd/Ctrl+P: files, sessions, surfaces, actions. `src/renderer/components/CommandPalette.vue`, `services/commandPalette.ts`.

### Renderer — Stores & Services

- **Sessions store.** Session state, filtering, draft persistence, status tracking. `src/renderer/stores/sessions.ts`.
- **Settings store.** Theme, editor prefs, model defaults, key status. `src/renderer/stores/settings.ts`.
- **Runs store.** Aggregated chat/app/agent status for Navigator. `src/renderer/stores/runs.ts`.
- **Pings store.** Per-row "ping when done" opt-in: watches run status transitions, plays a synthesized chime, tracks fired-ping state for row indicators. `src/renderer/stores/pings.ts`, `services/pingSound.ts`.
- **Resolved apps store.** Per-app enabled/visible/installed state. `src/renderer/stores/coreApps.ts`.
- **Model controls.** Chat/inline/ghost model selection. `src/renderer/services/ai/modelControls.js`.

### Renderer — Settings

- **Settings dialog.** Section-routed dialog: Appearance, AI, Instructions, Connections, Tools, Apps, Skills, Workspace, About. `src/renderer/components/settings/`. Section ids in `sections.ts` are a stable protocol for deep links.

### Renderer — Shared UI

- **UI primitives.** `MimDialog`, `MimSelect`, `MimMenu`/`MimMenuItem`, `MimContextMenu`, `MimSegmented`, `MimToggle`. `src/renderer/components/ui/`. See [design-system.md](design-system.md) §6.
- **Themes.** Light (white/parchment/glacier/sage) + dark (slate/monokai/nord/dracula) via `data-theme`. `src/renderer/styles.css`.
- **Toast store.** Global error/info notifications. `src/renderer/stores/toasts.ts`, `components/ToastHost.vue`.

### External Apps (shoulders-ai/mim-apps)

All user-facing apps live in [shoulders-ai/mim-apps](https://github.com/shoulders-ai/mim-apps), one per `packages/<id>/`. Core has no built-in apps.

- **Board** — issues model, `issues.*` named tools.
- **Knowledge** — knowledge model, `knowledge.*` named tools.
- **Slides** — deck generation via `render.htmlToPdf`, planner-first backend, design critique.
- **DOCX Review** — multi-agent peer review over core DOCX tools.
- **Scholar** — systematic literature search across academic DBs.
- **References** — DOI/PDF capture, managed library, `references.*` tools.
- **Import-MD** — file import UI over core `documents.importMarkdown`.

### Docs Index

| Doc | What it covers |
|---|---|
| [ontology.md](ontology.md) | Canonical concepts and naming laws (draft, under review) |
| [vocabulary.md](vocabulary.md) | Vocabulary migration decisions and execution waves (draft) |
| [gotchas.md](gotchas.md) | Non-obvious constraints and lessons |
| [code-execution.md](code-execution.md) | Code execution, toolchain detection, interpreter allowlist |
| [security.md](security.md) | Permission gate, trust model, actor modes |
| [design-system.md](design-system.md) | Visual language, tokens, interaction rules |
| [cli.md](cli.md) | Headless CLI commands |
| [mcp.md](mcp.md) | MCP stdio bridge to the desktop |
| [integrations.md](integrations.md) | Slack/Google tools, keychain, policy |
| [web-reading.md](web-reading.md) | Web/PDF reading, website access, evaluation harness |
| [html-markdown.md](html-markdown.md) | HTML-to-Markdown parser |
| [history.md](history.md) | Local file recovery |
| [git.md](git.md) | Git tools and managed sync |
| [export.md](export.md) | PDF/DOCX export pipeline |
| [document-pane.md](document-pane.md) | Editor surface architecture |
| [comments.md](comments.md) | Inline review comments (markdown + code) |
| [observability.md](observability.md) | Trace stream, audit, outcomes |
| [telemetry.md](telemetry.md) | Anonymous usage telemetry |
| [logbook.md](logbook.md) | Human-readable activity log |
| [resources.md](resources.md) | Shared resource collections |
| [skills.md](skills.md) | Filesystem skill system |
| [custom-apps.md](custom-apps.md) | Building workspace apps/skills |
| [granola-private-app.md](granola-private-app.md) | Private Granola app rationale, implementation, and operations |
| [private-registry.md](private-registry.md) | Private app registry (mim-web), client tokens, entitlements |
| [app-system-api.md](app-system-api.md) | App system contract and author API |
| [package-runtime.md](package-runtime.md) | App runtime architecture |
| [docx-review-workflow.md](docx-review-workflow.md) | DOCX review workflow |
| [auto-update.md](auto-update.md) | App auto-update and release builds |
| [agent-sessions.md](agent-sessions.md) | CLI agent sessions |
| [workbench-navigation.md](workbench-navigation.md) | Navigator/Work/Artifact pane model |
| [workbench-layout.md](workbench-layout.md) | Layout handoff for agents |
| [activity-review-rethink.md](activity-review-rethink.md) | Monitor surface design rationale |
| [brand/README.md](brand/README.md) | Logo toolkit and brand assets |

### Proposals

- [proposals/r-first-class.md](proposals/r-first-class.md) — **implemented** (phases 1-5; phase 6 deferred). First-class R/Rmd/Quarto: `code.run` execution primitive, plot/artifact viewing, Cmd+Enter send-to-terminal, render loop, R modelling skill.
- [proposals/ai-native-browser.md](proposals/ai-native-browser.md) — two-layer web access plan: cheap reader plus AI-native live browser with bounded observations and compact action refs.
- [proposals/side-by-side-editing.md](proposals/side-by-side-editing.md) — side-by-side editing workflow proposal.
- [proposals/tools-settings-tab.md](proposals/tools-settings-tab.md) — Settings > Tools plan for unified AI/MCP tool availability policy.

## File Tree

```
src/
  main/                         # Electron main process
    index.ts                    # Boot, window, IPC handlers
    autoUpdater.ts              # electron-updater
    cli.ts                      # Headless CLI commands
    headless.ts                 # Non-Electron tool registry boot
    sessions.ts                 # Session CRUD (JSON files)
    sessionManifest.ts          # Lightweight sessions cache
    userConfig.ts               # ~/.mim/config.yaml loader
    skills.ts                   # Filesystem SKILL.md loader
    menu.ts                     # Native application menu
    platform.ts                 # Cross-platform helpers
    pty.ts                      # Terminal spawning (node-pty)
    ptyCommand.ts               # Windows .cmd/.bat wrapping
    ptyShellIntegration.ts      # Scratch-zsh keymaps
    logbook.ts                  # .mim/log.md activity log
    htmlPdf.ts                  # Hidden-BrowserWindow HTML→PDF
    closeGuard.ts               # Quit guard decision
    atomicJson.ts               # Atomic JSON file writes
    history/history.ts          # Local per-file recovery store
    toolchain/
      toolchain.ts              # Binary detection, version, promise cache
    agents/
      agentCatalog.ts           # CLI agent detection
      agentSessions.ts          # Session lifecycle + persistence
      agentStatus.ts            # Pty signal tracker
    ai/
      ai.ts                     # Model registry, key resolver
      aiRuntime.ts              # Central AI runtime + tools
      agentContext.ts           # Runtime workspace digest
      systemPrompt.ts           # Dynamic AI system prompt
      workspaceTree.ts          # Bounded workspace tree prompt context
    packages/
      packages.ts               # App loader
      packageManifest.ts        # Manifest validation
      packageEnablement.ts      # Personal enablement + trust
      packageRuntime.ts         # Backend capability loader
      packageJobs.ts            # App job runner
      packageData.ts            # App-scoped JSON storage
      packageHttp.ts            # ctx.http host allowlist
      packageSecrets.ts         # ctx.secrets keychain
      namedPackageTools.ts      # Named app tools as registry tools
      packageContributions.ts   # Agent-context contributions
      registrySources.ts        # Multi-source resolution
      registryIndex.ts          # Registry index parser
      cacheLayout.ts            # ~/.mim/cache/ layout
      semver.ts                 # Strict semver helpers
    mcp/
      stdio.ts                  # MCP stdio bridge
      discovery.ts              # ~/.mim/server.json helpers
    resources/resourceModel.ts  # Shared resource collections
    search/
      search.ts                 # SQLite FTS5 session search
      fileSearch.ts             # Workspace file content search
      textMatch.ts              # Deterministic text matching
    security/
      gate.ts                   # Permission gate
      gate-paths.ts             # Path classifier
    server/server.ts            # Express + WebSocket server
    workspace/
      workspaceBoot.ts          # Last-workspace restore
      workspaceContract.ts      # mim.yaml schema/parser/scaffold
      workspaceFileWatcher.ts   # File-change events
    integrations/
      secrets.ts                # OS keychain boundary
      http.ts                   # HTTP boundary
      slack/                    # Slack client, tools, AI tools, policy
      google/                   # Google client, tools, AI tools, policy
    comments/model.ts           # Markdown inline comment parser
    comments/codeModel.ts       # @mim line-marker comments for code files
    comments/dispatch.ts        # Path-aware routing between the two models
    html/markdown.ts            # HTML-to-Markdown parser
    documents/
      importMarkdown.ts         # DOCX/XLSX/BIB/PDF → Markdown
      pdfExtract.ts             # PDF text extraction
    docx/                       # DOCX read/annotate helpers
    export/                     # PDF/DOCX export pipeline
    trace/
      trace.ts                  # Trace stream writer
      query.ts                  # Trace query/stats
      outcomes.ts               # Edit outcome tracker
    telemetry/                  # Anonymous usage telemetry
    tools/
      registry.ts               # Tool registry + dispatch
      fs.ts                     # File operations
      history.ts                # File history tools
      git.ts                    # Git tools
      sync.ts                   # Managed sync tools
      workspace.ts              # Workspace tools
      bridge.ts                 # Cross-surface messaging
      editorState.ts            # editor.state open-tab snapshot
      packages.ts               # App authoring tools
      coreApps.ts               # App enablement tools
      registryTools.ts          # Registry list/trust
      install.ts                # App install/add/share
      documents.ts              # DOCX/PDF/import tools
      export.ts                 # PDF/DOCX export tools
      render.ts                 # HTML→PDF render tool
      web.ts                    # Web read/search tools
      search.ts                 # Search dispatcher
      agents.ts                 # Agent session tools
      archive.ts                # History/archive tools
      settings.ts               # Settings persistence
      skills.ts                 # Skill tools
      logbook.ts                # Logbook tools
      trace.ts                  # Trace query tools
      toolPolicy.ts             # Settings > Tools availability policy
      toolchain.ts              # toolchain.status tool
      code.ts                   # code.run execution tool
      comments.ts               # Comment tools
      references.ts             # Bibliography tools
      resources.ts              # Resource collection tools
      account.ts                # Account token tools
      telemetry.ts              # Telemetry tools
    templates/
      appTemplates.ts           # Starter app scaffolds
      skillTemplates.ts         # Starter skill scaffolds

  preload/index.ts              # IPC bridge: window.kernel

  renderer/                     # Vue 3 SPA
    App.vue                     # Composition shell
    main.ts                     # Vue app mount
    styles.css                  # Tailwind, tokens, themes
    styles.contrast.test.ts     # WCAG contrast contract for all 8 themes
    stores/
      sessions.ts               # Session state + filtering
      settings.ts               # User preferences + theme
      workbench.ts              # Work/Artifact navigation state
      diff.ts                   # Editor diff review state
      approvals.ts              # Permission-request queue
      runs.ts                   # Aggregated run status
      pings.ts                  # Ping-when-done chime + indicators
      agents.ts                 # CLI agent catalog mirror
      coreApps.ts               # Resolved per-app state
      toasts.ts                 # Toast notifications
      resources.ts              # Resource collections
    services/
      ai/
        modelControls.js        # Model selection + defaults
        ghost.js                # Ghost completions client
        taskLabel.js            # Sidebar task labels
        errors.js               # AI error mapping
      appShell/                 # Tested shell adapters
      workbench/
        entries.ts              # Work/Artifact entry types
        history.ts              # Pane-history primitive
        commands.ts             # Command router
        hosts.ts                # Host resolvers
        keyRouter.ts            # Keyboard action router
        landingDecision.ts      # Boot surface decision
        artifactReplacement.ts  # Dirty-state guard
      attachments.js            # Attachment normalization
      pingSound.ts              # Web Audio completion chime
      approvalDiff.ts           # Approval preview content
      lineDelta.ts              # Added/removed line counts (LCS)
      currentDocument.js        # Active document bridge
      fileOpenPolicy.ts         # Editor vs native open
      renderDocument.ts         # Rmd/qmd render engine matrix
      toolchainStatus.ts        # Cached toolchain status (renderer)
      fuzzy.ts                  # Fuzzy scorer
      commandPalette.ts         # Palette sources + ranking
      shortcutLabels.ts         # Platform shortcut labels
      workspaceFileIndex.ts     # Cached file index
      citationHealth.ts         # Citation status
      comments/sendToChat.ts    # Comments → chat handoff
      sessionExport.ts          # Chat JSON export
    components/
      chat/
        ChatView.vue            # Main chat surface
        ChatMessage.vue         # Message rendering
        ChatCodeRunCard.vue     # code_run result card
        chatCodeRunCard.ts      # Run card view-model
        ChatComposer.vue        # Input + context chips
        InlineApproval.vue      # Inline permission card
        ModelPicker.vue         # Model dropdown
      editor/
        EditorPanel.vue         # Document tab host
        InlineAI.vue            # Cmd/Ctrl+K surface
        DiffReviewBar.vue       # Diff review toolbar
        DiffView.vue            # CodeMirror merge view
        HistoryRail.vue         # Go Back rail
        EditorTabStrip.vue      # Tab navigation
        EditorToolbar.vue       # Format buttons
        PreviewPane.vue         # Live markdown preview
        comments/               # Comment rail + cards
        codemirror/             # CM6 extensions
          sendToTerminal.js     # Cmd+Enter / chunk send logic
      terminal/
        TerminalPanel.vue       # Multi-tab shells + program tabs
        TerminalSurface.vue     # Single xterm ↔ pty
        terminalSendText.ts     # Line-joining for terminal send
      files/
        FilesWorkView.vue       # File browser orchestrator
        FilesTable.vue          # File rows
        ImageArtifact.vue       # Image viewer tab
        TableArtifact.vue       # CSV/TSV grid
      sidebar/
        ShellSidebar.vue        # Navigator orchestrator
        WorkspaceSwitcher.vue   # Workspace popover
        SessionRow.vue          # Chat activity row
        RunRow.vue              # App run activity row
      workbench/
        WorkbenchShell.vue      # Pane shell slots
        WorkHost.vue            # Work surface host
        ArtifactHost.vue        # Artifact surface host
        PaneHeader.vue          # Pane header controls
      agents/AgentSessionView.vue  # Agent session Work surface
      archive/ArchiveBrowser.vue   # History Work surface
      packages/PackageFrame.vue    # App iframe host
      settings/
        SettingsDialog.vue      # Settings shell
        sections.ts             # Section id protocol
        AppsSettingsPanel.vue   # Apps + CLI tools
        AiSettingsPanel.vue     # Keys + model defaults
        ConnectionsSettingsPanel.vue  # Integrations + website access
        ToolsSettingsPanel.vue  # Agent tool availability policy
        codeInterpreterRows.ts  # Interpreter toggle row logic
      ui/                       # MimDialog, MimSelect, MimMenu, MimContextMenu, etc.
      CommandPalette.vue        # Cmd/Ctrl+P palette
      AddProjectDialog.vue      # Open/New/Clone workspace
      InitWorkspaceBanner.vue   # Workspace init offer
      MissingAppsBanner.vue     # Missing shared apps

sdk/
  mim.js                        # WebSocket app SDK
  tokens.css                    # App design tokens

resources/
  ai-models.json                # Model catalog
  r/mim-run.R                   # Plot-capture harness for code.run
  icon.png                      # macOS dev dock icon

docs/                           # Implementation docs (see Docs Index above)
```

## Branding

- Product name: **Mim**. Internal package: `mim`.
- Workspace contract: `mim.yaml` + `AGENTS.md` + `CLAUDE.md`. Runtime (gitignored): `.mim/`.
- User-global: `~/.mim/config.yaml` (identity, defaults — no secrets). Keys: `~/.mim/keys.env`. Integration tokens: OS keychain.

## Maintenance

- When adding a subsystem, add a row under Systems and update the file tree.
- Keep entries concise and source-linked. Do not duplicate code or doc content here.
