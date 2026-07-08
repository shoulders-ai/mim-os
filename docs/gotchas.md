# Gotchas

Non-obvious constraints. Add to this whenever a fix depends on a subtle rule.

## AI SDK: inputSchema, not parameters

When defining tools with the Vercel AI SDK `tool()` function, always use `inputSchema`, never `parameters`. Using `parameters` silently breaks Anthropic (400 error: `input_schema.type: Field required`). `src/main/ai/aiSdkToolContract.test.ts` enforces this for production `src/main` files that import `tool` from `ai`.

## @ai-sdk/vue Chat state is reactive — never poll it

`@ai-sdk/vue`'s `Chat` keeps `messages`, `status`, and `error` in Vue refs (`VueChatState` in `node_modules/@ai-sdk/vue/dist/index.js`). Reading `chat.messages`/`chat.status`/`chat.error` inside a `computed`/template/`watch` is fully reactive, including streaming — `pushMessage` reassigns `.value` and `replaceMessage` mutates the reactive array in place; both notify dependents. Do **not** add `setInterval`/tick hacks to "force" reactivity (an earlier `ChatView.vue` did this). The only genuinely non-reactive piece is the plain `Map` of per-session `Chat` instances, so the active chat is surfaced through a `shallowRef` (`activeChatRef`) that `getOrCreateChat` assigns. `chatReactivity.test.ts` guards the streaming mutation patterns.

Build the `Chat` only after its session's history is loaded: `getOrCreateChat` awaits `sessionStore.ensureMessages(id)` before `new Chat({ messages })`, so an engine is never born empty for a session that has persisted messages (the old "chat is empty until you send a message" bug). `session.list` strips messages, so the store tracks hydrated ids to fetch each session's history exactly once.

## Trace grouping: thread the turn traceId, or you get orphan Activity runs

The Activity feed groups one run per `traceId` (`feedRuns` in `ActivityTrustView.vue`). Any `tools.call` made on behalf of a chat turn that does **not** carry the turn's `{ traceId, spanId }` in its `ToolContext` starts a fresh trace and therefore shows up as its own feed row. This is what made a single chat send look like 20+ unrelated activities: the pre-flight `skill.list`/`package.tools.list` and the closing `session.update` persistence ran with no trace context. The `chat.turn` root span is now created up front (`streamProfileResponse`) and threaded into all per-turn helpers, including context-compaction summary checks and compaction record writes. When adding any new per-turn helper call, pass the turn trace.

Single-shot housekeeping model calls (ghost, task-label, summary) are genuinely separate renderer-initiated requests, so they cannot inherit the turn trace — and the task-label deliberately uses the cheap `extract` model (this is why a sonnet chat showed a stray "haiku" `model.call`). They are filtered out of the feed by `run.kind === 'model'` (a run rooted on a bare `model` span) but stay in Health cost aggregation and the Timeline. Do not "fix" the haiku entry by forcing the chat model onto label generation — that is intended cost savings.

## Editor: dirty and externalState are separate facts

`useEditorFileSync.ts`'s `markTabChangedOnDisk`/`markOpenTabChangedOnDisk` set `tab.externalState` (drives the ConflictBar) but must **not** force `tab.dirty = true`. Dirty means "buffer differs from the last save" and drives close-confirmation prompts and the quit guard; externalState means "disk moved out from under this tab" and is fully recoverable (OS Trash, `.mim/history`). Conflating them made every external change — including ones the user caused themselves via the Files pane delete — falsely claim "unsaved changes" on a clean buffer. See [document-pane.md](document-pane.md) External Changes and Deletion section for the full user-delete-vs-external-delete split.

## Native modules require electron-rebuild

`better-sqlite3` and `node-pty` are native Node addons. After `npm install`, `electron-rebuild` runs via the `postinstall` script. If you add another native module, it must be rebuilt too or Electron will crash at runtime with a `NODE_MODULE_VERSION` mismatch.

## xterm line-boundary shortcuts are platform-specific

xterm.js deliberately drops arrow keys with `metaKey` on macOS, so Cmd+Left/Right never reaches the PTY as line-boundary movement. Keep macOS terminal text-navigation shims in `src/renderer/components/terminal/terminalKeybindings.ts`, where they can be tested as raw byte mappings before xterm handles the event.

On Windows and Linux the same shim is Ctrl+Left/Right, not Super/Meta+Arrow. Keep the platform branch in `terminalKeybindings.ts`; otherwise Linux users cannot trigger the documented line-boundary shortcut.

Terminal Shift+Enter and Option-arrow behavior are profile-specific. Scratch zsh terminals use the `terminal-zsh` renderer profile: Shift+Enter writes `CSI 13;2u`, which `ptyShellIntegration.ts` binds to a `mim-insert-newline` ZLE widget so the next plain Enter still accepts the whole shell buffer. Non-integrated scratch shells keep the legacy `\x16\n` (`quoted-insert` plus LF) fallback. macOS Option+Left/Right and Option+Shift+Left/Right must be intercepted and written as explicit xterm modified cursor sequences (`CSI 1;3D/C` for both, because shell line editing does not support macOS-style selection here); do not rewrite them to `Esc+b`/`Esc+f`, and do not rely on xterm's macOS Option text-modifier path to choose the bytes. Raw `Esc` word movement assumes an emacs/readline keymap and can switch zsh vi insert mode into command mode, where the next `x`, `u`, `b`, or `f` is interpreted as an editor command.

Scratch zsh terminals get their compatibility at shell startup. `terminal.spawn` opts into `ptyShellIntegration.ts`, which points zsh at a generated `ZDOTDIR`, sources the user's original `.zshenv`/`.zshrc`, then binds Shift+Enter's `CSI 13;2u` multiline widget, plain left/right arrows and backspace/delete for editable multiline buffers, xterm Option/Alt arrows, Home/End variants, Cmd+Arrow fallback bytes (`^A`/`^E`), and Option+Backspace (`^W`) in both `emacs` and `viins` keymaps. Keep this integration opt-in for scratch terminals only; agent sessions also use `spawnPtyProcess`, but they must not inherit shell startup shims.

Agent terminal surfaces use their agent id as the `TerminalSurface` keybinding profile. Agent Shift+Enter falls back to `\x1b\r` (Alt+Enter), matching the terminal setup guidance used by modern agent CLIs. Agent Cmd+Left/Right sends Home/End (`\x1b[H`/`\x1b[F`) instead of shell readline bytes. For agent profiles, do not rewrite macOS Option+Left/Right to readline `Esc+b`/`Esc+f`; xterm already emits standard modified cursor sequences for Alt/Option arrows, while raw-mode agent editors may parse Alt-letter commands as destructive editor actions.

Mim does not currently advertise Kitty/CSI-u keyboard protocol support. Do not respond to `CSI ? u` or enter enhanced keyboard mode unless the terminal layer encodes the whole key family it advertises; half-implementing only Shift+Enter leaves Option/Cmd arrows and deletion in an inconsistent parser mode.

## xterm startup needs a visible, measurable parent

xterm measures DOM geometry during `terminal.open(parent)`, and its parent must already be visible with nonzero dimensions. The scratch terminal is lazy-mounted through WorkHost and then kept under `v-show`, so opening xterm during the first mount can leave the helper textarea/input layer inert until a later hide/show or tab switch forces layout. `TerminalSurface.vue` therefore waits for an active, measurable container before calling `terminal.open()`, buffers PTY output until then, and refits/focuses when the terminal Work surface becomes visible again. Keep startup/visibility fixes in `TerminalSurface.vue` plus the WorkHost/TerminalPanel active prop path, not as incidental tab-switch side effects.

## Terminal tab PTY ids must be written through reactive state

`TerminalPanel.vue` stores tabs in a Vue reactive array. After pushing a new tab, do not keep mutating the original plain object across an `await` and expect the template to update; resolve the live tab from `tabs.value` before writing async results like `ptyId`. Otherwise `terminal.spawn` can succeed and the PTY can emit output while `TerminalSurface` still receives `ptyId=null`, so it never subscribes until an unrelated hide/show forces a rerender. `TerminalPanel.test.ts` guards that the spawned PTY id reaches the active surface immediately.

## Cross-platform home, shell, and display paths

Do not read `process.env.HOME` directly and never fall back to a literal `~`. Use `userHomeDir()` in `src/main/platform.ts`, which honors `HOME`, then `USERPROFILE`, then `os.homedir()`.

Do not hardcode `/bin/zsh` outside macOS behavior. Use `defaultShell()` so Windows gets `ComSpec`/`cmd.exe`, Linux gets `$SHELL` or `/bin/sh`, and macOS keeps `/bin/zsh` as the final fallback.

Any path sent to the renderer, agent transcript, search result, or tool result as a workspace-relative display path must use forward slashes via `toSlashPath()`. Actual filesystem operations still use Node path APIs. This keeps Windows `path.relative()` backslashes from breaking UI code that intentionally treats `/` as the display-path separator.

## Main-process resources move after build

Do not resolve bundled resources from a single `import.meta.dirname` path. Electron-vite can place shared main code in `out/main/chunks/`, so `../../resources` from that file points at `out/resources`, not the repo or packaged app resources. Use a multi-root resolver like `resolveRegistryPath()` in `src/main/ai/ai.ts`, and smoke-test built output when changing resource lookup.

The app iframe SDK has the same constraint. `/sdk/mim.js` and
`/sdk/tokens.css` are served by the local app server from `sdk/`, and they must
be included in `electron-builder.config.mjs` `files`. If they are missing from
the packaged app, every app iframe loads HTML 404 pages for the SDK assets:
`mim.js` 404s and `tokens.css` is rejected for `text/html` MIME type.

## Package server port is dynamic

`src/main/server/server.ts` binds to port 0 (OS-assigned random port). The renderer gets the port via `window.kernel.getPort()`. Package iframes discover it from their own URL. Never hardcode a port number.

## MCP allowlist belongs in the desktop server

`mim mcp` exposes only a curated tool surface, but the stdio process is not the
security boundary. Any local process with the bearer token from
`~/.mim/server.json` can speak to the desktop WebSocket directly. Keep the MCP
allowlist enforced in `src/main/server/server.ts` before `tools.call()`, and
keep `__meta.tools` MCP-only and identified-only. The stdio bridge may mirror
the map for DX, but it must not be the only restriction.

## Package launch tokens must outlive their mint window once identified

Package iframe URLs are long-lived: the work pane keeps `PackageFrame` under `KeepAlive` with a cached launch URL, and browsers reload an iframe from its existing `src` every time it is reattached to the DOM. So navigating away from a package view and back replays the **original** launch token — possibly minutes later. Launch tokens (`src/main/server/server.ts`) therefore expire only while unused: the 60s `expiresAt` window applies to tokens that never identified, and the first successful `identify` clears it so the same URL keeps re-identifying for iframe remounts and SDK reconnects. Do not reintroduce a hard token expiry; it resurfaces as intermittent package UI startup failures after >60s away. Relatedly, `sdk/mim.js` must reject `ready` when identify fails — swallowing the failure makes every later call fail with the unidentified-connection error instead of the real cause.

## Popovers in clipped chrome

Sidebar and pane popovers that can escape their parent bounds must use `Teleport` to `body`; fixed or absolute children inside overflow-hidden chrome will be clipped.

## Floating overlays must not animate position

Teleported/floating overlays start life before runtime positioning has fully settled. If their enter/leave transition uses Tailwind duration/easing without an explicit transition property, CSS transitions `all`, so floating-ui or fixed-position corrections can animate from `0,0` or a window edge to the final anchor. Keep `MimMenu` and `MimDialog` transitions opacity-only (`transition-opacity`) unless you can prove the element is already positioned before the first painted frame.

## Local Markdown Images

Do not use `file://` URLs for editor preview images. The BrowserWindow keeps Electron's default web security enabled. Local Markdown images are rendered through `fs.readImageDataUrl`, which resolves paths inside the current workspace and returns image data URLs for the renderer. The same constraint drives the PDF Artifact viewer: `PdfArtifact.vue` loads PDFs from the kernel server's GET-only `/workspace-files/<path>` route (`src/main/server/server.ts`), never from `file://`.

## Inline comments need the CM6 protection bypass

Markdown comments are real inline tags on disk, but hidden in the editor with CodeMirror replace decorations and atomic ranges. Normal typing must not touch those hidden spans, so `codemirror/comments.js` uses `EditorState.changeFilter` to reject edits that intersect tag markup. Any programmatic operation that intentionally creates, removes, or rewrites comment tags must dispatch with `annotations: commentMutation.of(true)`; otherwise CodeMirror will block the transaction or make whole-document replacements appear to do nothing.

One cursor position can still exist at a hidden tag boundary. That is a CM6 flat-document limitation, not a parser bug. Backspace/Delete handlers redirect boundary deletes, and the accepted invariant is: anchors remain editable, hidden tag spans do not.

Comment tools in main refuse to mutate a file that is open and dirty in the editor. The renderer pushes dirty open paths to main with `pushDirtyTabCount({ count, paths })`; keep that payload shape if the quit guard or editor dirty tracking changes.

## CLI Secret Parameters

Do not document secret-bearing `mim tool` examples with tokens directly in the command line. Use `mim tool <name> --stdin` so JSON can come from a trusted local prompt or pipe without putting tokens in shell history.

Generic `mim tool` dispatch must stay on the `ai` actor and pass through the headless permission gate. Non-interactive approval-required calls are denied, TTY calls prompt, and `--yes` is the only intentional auto-approval path for trusted local automation.

## Search index failures are non-fatal

`initSearchDb` and `rebuildIndex` are wrapped in try/catch in `index.ts`. If SQLite fails (permissions, corrupt db), the app still boots — search just silently returns empty results.

## Trace log failures are non-fatal

`TraceLog.append()` runs before tool execution in `ToolRegistry.call()`. It must never throw: if the active workspace was deleted while the app is running, a throw from `.mim/traces/` blocks `workspace.open` and leaves the user unable to switch folders. Only create `.mim/` when the workspace root still exists, swallow sink errors, and treat audit persistence as best-effort. The same applies to `writePayload` (returns `null` instead of throwing).

## Automatic history baselines must be bounded

Electron schedules local-history baselines after boot and workspace switches. Keep those automatic calls delayed and bounded; a full synchronous `history.baseline` over a broad workspace can block main-process startup before the window becomes usable. Manual `history.baseline` can remain full-scan, but startup/switch recovery should pass scan, capture, and time limits and tolerate a `truncated` result.

## Do not reintroduce recursive workspace watchers

The main workspace file watcher must stay scoped to explicit renderer
registrations for open files. A broad Chokidar watch over a research workspace
can consume thousands of file descriptors after copied-in data, then Chromium
sandboxed iframes fail to launch. Package freshness uses separate shallow
package and `mim.yaml` watchers; do not use the main watcher as a general
workspace event bus.

## Theme attribute is data-theme, not a class

Themes are applied via `<html data-theme="white">`, not CSS classes. The app default is White (`DEFAULTS.theme` in `stores/settings.ts` plus `data-theme="white"` on `<html>` in `index.html` so the first paint is correct before settings load). Tailwind `@theme` block is the unresolved-token fallback only. Each `[data-theme]` selector overrides the full token set.

## ai.generateObject must use Anthropic's json-tool path, not native structured outputs

`@ai-sdk/anthropic` (v3+) auto-enables the `structured-outputs-2025-11-13` beta for any model that advertises support (Sonnet 4.6, Haiku 4.5, Opus 4.x, …). That makes Anthropic compile the JSON schema into a constrained-decoding **grammar** server-side. Non-trivial schemas — nested arrays of objects, the kind any real package job produces — exceed the compiler's time budget and fail the entire call with `Grammar compilation timed out.` after ~140s. This is what made the slides deck planner hang then die. `generateObjectWithAi` (`src/main/ai/ai.ts`) forces `providerOptions.anthropic.structuredOutputMode = 'jsonTool'` (via `objectGenerationProviderOptions`), which sends the schema as one forced tool call: no grammar, ~5s, still SDK-validated. Do not remove this; do not switch object generation back to `auto`/`outputFormat`.

## AI key status must be shared, never cached per-surface

The main process re-resolves provider keys on every request (`resolveKey` reads `~/.mim/keys.env` fresh, falling back to `process.env`), so a key change is live in main immediately. The file wins over the environment on purpose: Settings must stay authoritative, otherwise a key exported in the shell that launched the app silently shadows every set/replace/remove made in the app. The renderer is what goes stale: AI surfaces read provider-configured booleans, and if each component fetches `ai.keyStatus` once on mount and caches it locally, adding a key in Settings won't reach chat/inline until an app restart. Read key status only from the shared settings store (`keyStatuses`/`providerConfigured`/`anyKeyConfigured`); never re-introduce a per-component copy. `ai.setKey`/`ai.clearKey` emit `ai:keys-changed` (sent to the renderer and broadcast to package iframes); `App.vue` re-fetches the store on that event, and long-lived closures (e.g. the chat engine's `prepareSendMessagesRequest`) must read the store ref live rather than snapshot it.

## Shared resources: mim.yaml only round-trips known keys

`serializeMimYaml` (`src/main/workspace/workspaceContract.ts`) emits **only** recognized keys — comments and unknown top-level keys are dropped on the next write. The resource tools read-modify-write `mim.yaml` through `parseMimYaml`/`serializeMimYaml`, so anything not in the schema is lost. When adding a committed field, extend both the parser and serializer (and `parseCollections`/`serializeCollections` for the `collections:` map). The `collections:` serializer also intentionally drops local machine paths: only `name/git/write` travel in `mim.yaml`; folder paths live in gitignored `.mim/resources.json` and must never leak into the committed file.

## Shared resources: mounts are symlinks under .mim/resources, mirrors are a third storage location

A mounted collection is a **symlink** at `.mim/resources/<id>` pointing at its backing root. `syncMounts` only ever creates/removes symlinks; a real file/dir squatting on a mount path is reported as a conflict and left untouched, and foreign symlinks outside the mounts dir are never touched. Because `fs.list` skips `.mim` and never follows symlinks, mount files are invisible to the normal walk — the file index (`workspaceFileIndex.ts`), file search (`fileSearch.ts`), and Files browse tree each list mounts explicitly. Git mirrors live in `app.getPath('userData')/resources/<hash>/repo` — a per-machine cache shared across workspaces and a **third** storage location beyond the workspace tree and `.mim/`. It is never committed and is not part of the workspace, so a clone on another machine has no mirror until `resources.sync` runs (status `not-synced` until then).

## Symlinks refused in installed package trees

The install tools (`tools/install.ts`) refuse symlinks in package checkouts before copying. A symlink escaping the package directory would be imported or served from inside the package while actually pointing somewhere else, so installs fail loudly instead of preserving it. The check skips `.git`.

## Flat global package dirs skipped with diagnostic, no migration

The global packages directory uses a two-level layout: `~/.mim/packages/<id>/<version>/package.json`. If a `package.json` exists directly under `~/.mim/packages/<id>/` (the old flat layout), the loader emits a diagnostic and skips the entire id directory. There is no migration path — manually restructure the directory or reinstall through `package.install`.

## Legacy apps map key `issues` breaks loudly

The `mim.yaml` `apps:` map is keyed by package id (`board`, `knowledge`), not by app name. The legacy `issues` key is skipped by the parser (`workspaceContract.ts` `LEGACY_APP_KEYS`) and the loader surfaces a diagnostic naming the replacement (`mim.yaml apps: legacy key "issues" is ignored — use "board"`). There is no shim or migration — a workspace that still has `apps: { issues: true }` will not share or pin the board package; change it to `apps: { board: true }`.

## Committed app pins do not activate code

A committed `mim.yaml` app entry means "this workspace uses this app" and may pin `source`, `path`, and `version` for collaborators. It never adds the app to anyone's sidebar or activates backend/tools by itself. Personal activation lives in gitignored `.mim/packages/enabled.json`, and vendored workspace apps with backend code or effective permissions still require a local trust ack before they run.

## Enabled headless apps do not get sidebar launchers

`enabled` means the app can contribute its backend jobs/tools/skills for this user. The Navigator only renders launchers for enabled, installed apps that expose a view. A package with `mim.views: []` can be correctly enabled and still have no sidebar entry; adding a view in a later installed version makes the launcher appear once the loader selects that version.

## Multiple installed app versions are normal

Global installs are side-by-side under `~/.mim/packages/<id>/<version>/`. Updating an app does not delete older versions. The loader chooses the workspace-pinned version when `mim.yaml` pins one, otherwise the highest installed semver. Settings > Apps Browse collapses multiple registry entries with the same app id to one row for the newest registry version.

## Shared resources: readonly writes are hard-denied for every actor

The permission gate denies writes to `readonly`/unknown resource collections (and to mount roots) for **every** actor — user, ai, package, and even developer-bypass mode — *before* any allow path. This is intentional: a write to a pull-only git mirror would be clobbered on the next sync, and readonly is the safe default for shared assets. Only `direct` collections accept writes, and those still go through the normal approval flow. Do not "fix" a blocked write by loosening the gate; change the collection's write policy instead (`resources.setPolicy`, or the badge toggle in Settings → Resources). Git collections are always readonly regardless of config.

## Package UI iframes can only load files under ui/

`resolvePackageUiPath` (`src/main/server/server.ts`) serves package view files relative to the view's own directory and rejects any `..` escape. A package UI script therefore **cannot** `import '../shared/foo.mjs'` — shared package modules are reachable from the backend (plain ESM relative imports work there, the runtime loads `backend/index.mjs` via a `file://` URL) but not from view iframes. If UI and backend need the same logic, the UI keeps its own copy with a comment pointing at the shared module (see the slides package's `ui/index.html` `deckCapableModels` in shoulders-ai/mim-apps `packages/slides/`).

## GUI Electron gets the launchd PATH on macOS; Windows uses where.exe

A GUI-launched Electron app inherits launchd's PATH, which lacks
`/opt/homebrew/bin` and every shell-profile addition — so `command -v claude`
against `process.env.PATH` misses most CLI agent installs. Agent detection
(`src/main/agents/agentCatalog.ts`) therefore resolves POSIX binaries through
the user's shell (`$SHELL -lic 'command -v <bin>'`, or `/bin/sh -lc` when the
fallback shell is plain sh), takes the last non-empty stdout line (login shells
echo profile noise first), requires an absolute path, and caches the result for
the app lifetime — shell startup is expensive.

Windows has no login-shell contract and npm/pnpm tools usually expose `.cmd`
shims. Detection uses `where.exe <bin>` and accepts Windows absolute paths.
PTY spawning wraps `.cmd`/`.bat` through `cmd.exe /d /s /c`; do not bypass the
cached `binPath` by spawning a bare binary name. `resetAgentDetection()` clears
the cache (tests, future refresh).

## Linux window chrome and packaging

`titleBarStyle: 'hiddenInset'` and `trafficLightPosition` are macOS-only. Keep
them behind `mainWindowChromeOptions('darwin')`; on Linux/Windows the default
native frame is required for normal close/minimize/maximize controls.

Linux startup appends Electron's Ozone auto-detection flags in `configureLinuxCommandLine()` so Wayland desktops can choose the right backend. The release builds AppImage, deb, and tar.gz: AppImage may still need distro fuse support, while deb and tar.gz are the fuse-free alternatives.

## DOCX worker resources use electron-builder OS names

The .NET DOCX worker build writes `resources/docx-worker/<os>-<arch>/` using electron-builder OS names (`mac`, `win`, `linux`), not Node's `process.platform` names (`darwin`, `win32`, `linux`). The runtime resolver still checks legacy local layouts, but packaged builds and CI verification use the electron-builder names. Keep `electron-builder.config.mjs`, `scripts/build-docx-worker.mjs`, `scripts/verify-docx-worker-resource.mjs`, and `src/main/docx/worker.ts` in sync.

## Ptys die with the app: 'running' agent records reconcile to 'interrupted'

node-pty processes are children of the Electron main process; they do not
survive quit or crash. An agent session record left at `status: 'running'`
on disk is therefore a lie at the next boot. `reconcileStaleSessions()`
(`src/main/agents/agentSessions.ts`, called at boot in `index.ts`) marks every
`running` record without a live pty as `interrupted` and stamps `endedAt`.
Mirrors the package-jobs boot reconciliation; the renderer maps `interrupted`
to an error-state row.

## Agent session delete events must prune, not upsert

`agent.sessions.delete` removes the `.mim/agent-sessions/<id>.json` record and
its `.scrollback` file, then emits `agent:session-event` with
`type: 'session.deleted'`. Renderer consumers must remove that session id from
their aggregate stores. If delete is modeled as a normal `session.changed`
upsert, the UI re-adds a record that no longer exists on disk; reopening it then
fails with `Agent session not found` while the Activity/History row appears
stuck.

## Agent scrollback is byte-capped; xterm replay tolerates the cut

Agent session scrollback is a raw append file capped at 2 MiB: when exceeded
it is rewritten keeping only the most recent 1 MiB (front truncation at an
arbitrary byte offset, no line or escape-sequence alignment). This coarse cut
is deliberate — xterm replay resynchronises on the next escape sequence, so a
mangled first line is the worst case. Do not "improve" the truncation with
sequence-aware parsing; it buys nothing visible.

## OSC-terminator BEL is not a needs-input bell

The status tracker (`src/main/agents/agentStatus.ts`) maps BEL (`\x07`) to
`needs-input` — but BEL is also a legal OSC terminator (`ESC ] 0 ; title BEL`
is how most shells set the window title). A naive scan would flag every title
update as needs-input. The tracker is a real escape-sequence state machine:
BEL inside an OSC (or DCS/PM/APC/SOS string) terminates the sequence and is
not a signal, and parser state carries across pty chunk boundaries so a
sequence split mid-chunk still parses. Keep any new output-signal logic
inside that state machine, not as a substring scan.

## Nested dialogs must use :open, not v-if

Headless UI v1's Dialog stack counter does not properly decrement when a nested Dialog is unmounted via `v-if`. After the child unmounts, the parent dialog's Escape and click-outside-to-close permanently break. Always keep nested MimDialog/PermissionConfirmDialog instances mounted and control visibility via the `:open` prop. Guard prop accesses with optional chaining when the backing data is null.

## Nothing synchronous on main that scales with workspace or history size

Never add synchronous I/O to the main process that grows with the number of workspace files, sessions, or history entries. Use `fs/promises` or `child_process` async variants for anything that walks directories or reads multiple files. Synchronous reads that block the event loop freeze the entire app — streaming, IPC, window rendering, everything. The FTS reindex, file content search, and git-log author lookup were all converted from sync to async for this reason. New features that touch workspace-sized data must be async from the start.

## resources/ ships inside asar — spawned processes cannot read it

Electron packages `resources/` inside `app.asar`. External processes (Rscript, quarto) cannot read files from inside the archive. Anything spawned as a child process must be listed in `electron-builder.config.mjs` `asarUnpack` and the resolved path must map `app.asar` to `app.asar.unpacked` at runtime. `resources/r/**` is asarUnpack'd for the plot-capture harness (`mim-run.R`).

## Knitr fence info strings need normalization before language matching

`@codemirror/language-data` expects plain language names (`r`, `python`). Knitr/Quarto fence info strings like `{r, echo=FALSE}` must be normalized: strip surrounding `{}`, split on whitespace or comma, take the first token. Language names from `@codemirror/language-data` are case-insensitive but conventionally lowercase. The `resolveFenceLanguage` function in `codemirror/language.js` handles this normalization.

## POSIX timeout kill must signal the process group

When killing a timed-out child process on POSIX, signal the process group (`process.kill(-pid, signal)`) not just the pid. R and quarto spawn their own child processes; killing only the parent leaves orphans consuming resources. `code.run` spawns with `detached: true` and kills via `-pid`. Windows uses `taskkill /pid <pid> /T /F` (the `/T` flag kills the tree).

## SVG is intentionally NOT in the shared attachment MEDIA_TYPE_MAP

`src/renderer/services/attachments.js` defines `MEDIA_TYPE_MAP` for model-facing attachments. SVG is deliberately excluded: model providers reject SVG as an image attachment type. The in-app image viewer handles SVG fine (it renders in `<img>` tags), and `fs.readImageDataUrl` special-cases `.svg` by returning `image/svg+xml` as the media type for local preview. Do not add SVG to the attachment map.

## Broadcast vs. targeted IPC channels

`broadcastToRenderers` in `src/main/index.ts` fans an event to ALL renderer windows (main + pop-outs). Only workspace-global state channels belong there:

- `workspace:files-changed` -- every editor window must see file mutations.
- `workspace:changed` -- identity change affects all windows equally.
- `apps:changed` -- apps are workspace-scoped; every window refreshes.
- `ai:keys-changed` -- provider key availability is window-independent.
- `settings:changed` -- theme and preferences apply everywhere.

Every other channel stays on `sendToRenderer` (main-window-only):

- `gate:request` -- approval cards live only in the main window's chat. Broadcasting would enqueue duplicates and risk double-handled approvals.
- `packages:changed`, `resources:changed` -- only the main window's Navigator reacts; pop-outs have no Navigator or resource UI.
- Package job events, agent session events, auto-updater -- main window surfaces only.
- `bridge:*` commands -- always target one specific window (the main window).
- `menu:*` commands -- Phase 2 will add focused-window routing; until then they target main.

When adding a new IPC event, default to `sendToRenderer` (main-only). Promote to `broadcastToRenderers` only when pop-out windows genuinely consume the event, and verify no handler on the receiving side has side effects that break when invoked twice.

## Agent tool allowlists use canonical dotted ids, not AI SDK keys

The `tools` array in an agent descriptor uses canonical registry tool ids
(dotted names like `fs.read`, `search.files`), not the AI SDK keys the model
sees (underscored: `fs_read`, `search_files`). The registry resolves them.
Core tools that have explicit AI key aliases are the exception: `shell.run` is
exposed to the model as `bash` and is allowlisted as `shell.run`. Unknown ids
are load-time diagnostics, not silent no-ops.

## App iframes must never be detached from the DOM while alive

Re-inserting an `<iframe>` into the DOM resets its browsing context: the app inside reboots from scratch (module graph, WebSocket identify, data load — around a second of blank frame). Vue's `KeepAlive` detaches the subtree on deactivate, so it does NOT preserve iframes. `WorkHost` therefore keeps every visited `PackageFrame` mounted and hides inactive ones with `v-show`; frames are only remounted when the `packages` list identity changes (install/reload/workspace switch), which is what lets `app.reload` deliver fresh app code. Keep any new iframe-hosting surface on the same pattern.

## Package tool result capping is actor-conditional, not universal

`capPackageResult` in `packageRuntime.ts` truncates a tool's result at 24,000 characters, but `executeTool` only applies it when `ctx.actor === 'ai'`. App iframes (`actor: 'package'`), MCP clients, and the CLI (`actor: 'user'`) receive results uncapped, since they consume structured JSON and a silent `{truncated, content}` wrapper reads to them as "no data" rather than an error. Widening the cap back to all actors — e.g. "simplifying" the condition away — will reintroduce apps like Knowledge silently rendering empty states once a workspace's content grows past 24k serialized characters. Note `mim tool` on the CLI intentionally calls through with `actor: 'ai'` (cli.ts), so it stays capped by design — that's not a bug.

## Renderer dev-server port is pinned because localStorage is origin-keyed

`electron.vite.config.mjs` pins the renderer dev server to `port: 5174` with `strictPort: true`. Renderer `localStorage` (recent workspaces, etc.) is scoped to the page origin, and in dev the origin is `http://localhost:<vite-port>`. Without a fixed port, electron-vite falls back to the next free port whenever something else holds 5173, silently landing the app on a fresh empty origin — recent workspaces (and anything else in localStorage) appear to vanish, even though the old origin's data is still on disk in the Electron `Local Storage/leveldb` files. Packaged builds load via `file://` and are unaffected. If this port ever needs to change, expect a one-time "recents reset" for anyone with existing dev-mode localStorage state.
