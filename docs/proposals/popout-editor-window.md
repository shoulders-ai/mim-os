# Proposal: Pop-out editor windows

**Status:** Planned (supersedes `side-by-side-editing.md`, which recommended diff-based
comparison as a stopgap and deferred multi-window as "architecturally expensive" —
that assessment assumed a second full app shell; this plan avoids one)
**Goal:** Move any editor tab into its own OS window, and move it back — so users
can see multiple documents side by side, across monitors, with native window
management.

## Why this shape

The user need is "multiple editors next to each other". Three options were
evaluated:

- **Split Artifact pane** (VS Code-style split): keeps everything in one window
  but requires refactoring `EditorPanel`'s single-`tabs` model into N tab sets,
  plus focus/current-document ambiguity. Deferred — it can be layered on later
  and is orthogonal to this plan.
- **Compare-in-DiffView** for arbitrary file pairs: cheap but read-only, and
  doesn't serve "work on two documents at once".
- **Pop-out window** (this plan): a dependency audit showed `EditorPanel.vue`
  is almost entirely self-contained — one prop (`port`), all I/O through
  `window.kernel` (window-neutral preload), own keyboard shortcuts, own
  file-change subscriptions, inline AI and ghost over local HTTP. Mounting the
  **real** `EditorPanel` in a slim second-window shell gives ~95% fidelity for
  wiring work, not rebuild work.

The pop-out is **not** a second app shell. It never runs `App.vue`,
`registerAppKernelEvents`, the workbench store, or the Navigator. That is what
keeps it cheap and avoids double-handled events (duplicate approval cards,
duplicate toasts).

## UX specification

### Vocabulary

Tabs are **moved**, never duplicated. "Pop out" moves the active tab from the
main window into a new pop-out window and closes it in the main window.
"Move to main window" does the reverse. The same file open in two windows at
once is possible only if the user explicitly re-opens it, and is then governed
by the existing external-change conflict machinery (see Hazards).

### Entry points

1. **Tab-strip button (primary).** An icon button in the editor tab-strip row's
   trailing cluster, next to the existing History button
   (`EditorPanel.vue` template, the `h-7` chrome row). Icon: `IconExternalLink`
   (Tabler), 13px, same sizing/hover treatment as the History button
   (`hover:bg-chrome-mid hover:text-ink`, no pointer cursor — design-system §7).
   - In the main window: title `Move tab to new window`.
   - In a pop-out window: same slot becomes `Move tab to main window`
     (icon `IconArrowBackUp`). This is the only "move back" control — the
     pop-out header does not duplicate it.
   - Hidden while a history preview or diff review is active (same guards as
     other toolbar actions).
2. **Command palette.** Action `Move Tab to New Window` (main window only —
   pop-outs have no palette).
3. *(v2, not in scope)* Drag a tab out of the strip to detach, browser-style.

No dedicated keyboard shortcut in v1; the palette covers keyboard users and we
avoid burning a chord before usage proves demand.

### The pop-out window

```
┌──────────────────────────────────────────────┐
│ ●●●   report.md — mim-workspace               │  36px drag header, chrome-high
├──────────────────────────────────────────────┤
│ [report.md ×] [data.csv ×]  +   ⇤  ⏱ History │  EditorPanel's own tab strip
├──────────────────────────────────────────────┤
│                                              │
│         full EditorPanel surface             │
│   (CodeMirror / PDF / table / image / card)  │
│                                              │
└──────────────────────────────────────────────┘
```

- **Chrome.** macOS: `titleBarStyle: 'hiddenInset'` with traffic lights, same
  as the main window. A 36px header bar (`bg-chrome-high`, `border-b
  border-rule-light`) is the drag region (`-webkit-app-region: drag` — one of
  the permitted `<style>` uses). It shows only the active tab name plus
  workspace name in `text-ink-3` — no controls; the header is identity-only.
  All tab actions, including move-back, live in the tab strip below, the
  same location as the main window's pop-out button. Windows/Linux: standard
  OS frame; the header bar remains (without traffic light inset) so the
  identity line stays consistent.
- **Below the header is an unmodified `EditorPanel`** — full tab strip,
  toolbar, comments rail, history rail, preview, conflict bar. A pop-out is a
  real multi-tab editor: it can hold several documents (File > Open and
  Cmd+T route to the focused window; links/citations opened from inside a
  pop-out open as tabs in that pop-out).
- **Window title** mirrors the active tab (`report.md — Mim`). On macOS the
  plan also wires `win.setDocumentEdited(dirty)` (native dirty dot in the
  close button) and `win.setRepresentedFilename(absPath)` (proxy icon /
  title-bar path menu) — cheap, deeply native touches.
- **Sizing.** New pop-outs open at 980×760 (min 500×360), cascaded +28px
  from the last pop-out (or from the main window for the first). v1 does not
  persist geometry.
- **Empty pop-out auto-closes.** When its last tab closes (`allTabsClosed`),
  the window closes and the main window is focused. No dead shell windows.
- **Theme and settings** match the main window live (see Settings sync below).

### Semantics (decided, with rationale)

| Situation | Behavior | Why |
|---|---|---|
| Pop out a **dirty** tab | Full tab state (content, selection, scroll, view mode) transfers; no save prompt, no data loss | Moving should feel like physically carrying the tab |
| Pop out an **untitled** tab | Allowed; content transfers | Same principle |
| Pop out each time | Always creates a **new** window | Predictable; merging into an existing pop-out needs a target picker — deferred |
| Move a tab back | Tab (with full state) reopens in the main window; focus does **not** jump unless the pop-out auto-closed | Don't steal focus mid-flow when other tabs remain |
| Close pop-out with dirty tabs | Native confirm via the existing `closeGuardDecision` wording ("You have N unsaved tabs…") | Consistent with the app's quit guard |
| Close the **main** window | Closes the whole app including pop-outs, after an **aggregate** dirty guard across all windows | Mim's model is one workspace, one app; orphan pop-outs would be zombies |
| Quit (Cmd+Q) | Aggregate dirty count across all windows in the quit guard | A dirty pop-out must block a silent quit |
| Workspace switch | Main process closes all pop-outs first (dirty guard per window) | Pop-outs are workspace-scoped; cross-workspace pop-outs would be lying UI |
| App relaunch | Pop-out windows are **not** restored; only the main window's tabs persist | v1 simplification, documented; restore is v2 |
| `editor.open` bridge / chat "open file" | Targets the main window **unless** a pop-out already has that file open, in which case that pop-out is focused and the tab activated | Never open a second copy of a file the user deliberately popped out |
| Send to terminal (Cmd+Enter) from pop-out | Forwards to the main window's terminal; **no focus change** | REPL-style repeated sends must not yank focus |
| Send comments to chat / Request AI review from pop-out | Forwards draft to main window chat **and focuses the main window** | One-shot action; the user's next step is composing there |
| Approval-sourced diffs (AI edits from chat) | Open in the **main window's** editor, as today — even if the file is popped out the review happens in main | Approvals belong with the chat that triggered them; documented, not bridged |

### Hazards handled

- **Same file in two windows:** the `fs.write` `expected_hash` guard already
  makes silent clobbering impossible. A save in window A raises the standard
  external-change flow in window B (clean tab → reload; dirty tab →
  ConflictBar). This is existing, correct machinery — it just needs
  `workspace:files-changed` broadcast to all windows.
- **Tab persistence:** pop-outs do **not** write `.mim/editor-tabs.json`
  (persistence disabled in pop-out role) so they can't clobber the main
  window's restore state.
- **Quit guard blind spots:** dirty counts and editor-state snapshots become
  per-window (keyed by `webContents.id`) and are aggregated in main, so the
  quit guard and the `editor.state` MCP tool can't miss a pop-out.

## Architecture

### New pieces

```
src/main/windows/popoutWindows.ts        window registry, create/route/close, pure decision helpers
src/main/windows/popoutWindows.test.ts
src/renderer/popout.html                 second renderer entry (electron-vite multi-page)
src/renderer/popout.ts                   createApp(PopoutShell) + Pinia
src/renderer/components/popout/PopoutShell.vue
src/renderer/components/popout/popoutShell.test.ts
src/renderer/components/editor/editorTabTransfer.ts       serialize/adopt tab state (pure)
src/renderer/components/editor/editorTabTransfer.test.ts
src/renderer/services/themeSync.ts       extracted theme application (shared App.vue + PopoutShell)
```

### Serialized tab transfer

```ts
interface TransferredTab {
  path: string | null          // null = untitled
  kind: 'text' | 'pdf' | 'table' | 'card' | 'image'
  name: string
  dirty: boolean
  content?: string             // present iff dirty or untitled (clean tabs re-read from disk)
  selection?: { anchor: number; head: number }
  scrollTop?: number
  viewMode?: string            // source / preview / split
}
```

Transfer is an **ack'd handshake** so a tab can never be lost: source window
serializes → `popout:open-with-tab` (invoke) → main creates the window
(**hidden**, `show: false`), waits for the pop-out shell's `popout:ready`,
delivers the tab on channel `editor:adopt-tab`, calls `popout.show()`, then
resolves the invoke → only then does the source close its copy. The window
stays hidden until the tab is delivered, so there is never a blank-window
flash. Any failure resolves `{ ok: false }` and the hidden window is
destroyed; the source tab stays put. Move-back uses the same shape via
`popout:return-tab` → main emits `editor:adopt-tab` to the main window.

### IPC surface (all new channels prefixed `popout:`)

| Channel | Direction | Purpose |
|---|---|---|
| `popout:open-with-tab` | main-window renderer → main (invoke) | Create pop-out, deliver tab, ack |
| `popout:return-tab` | pop-out renderer → main (invoke) | Route tab to main window, ack |
| `popout:ready` | pop-out renderer → main (invoke) | Shell mounted; safe to deliver tabs |
| `popout:forward` | pop-out renderer → main (invoke) | `{ type: 'terminal.send' \| 'chat.prepareDraft', payload }` re-emitted to the main window |
| `popout:set-edited` | pop-out renderer → main (invoke) | Drives `setDocumentEdited` / `setRepresentedFilename` |
| `editor:adopt-tab` | main → any renderer (event) | Deliver a `TransferredTab` to a window's EditorPanel |
| `popout:main-command` | main → main-window renderer (event) | Forwarded terminal/chat commands, handled in `kernelEvents.ts` → existing `dispatchWorkbenchCommand` / `prepareChatDraft` paths |

Existing channels reused: `editor:dirty-state` and `editor:state` (gain
per-sender keying, below); `menu:*` (gain focused-window routing).

### Main-process changes (`src/main/index.ts` + new module)

1. **Window registry.** `popoutWindows.ts` owns a `Map<number, BrowserWindow>`
   plus per-window metadata (dirty count, editor-state snapshot). `index.ts`
   keeps `mainWindow` as-is.
2. **Broadcast vs. targeted send.** Add `broadcastToRenderers(channel, ...)`
   (all non-destroyed windows). Switch to broadcast **only** the channels
   pop-outs consume: `workspace:files-changed`, `workspace:changed`,
   `apps:changed`, `ai:keys-changed`, and new `settings:changed`. Everything
   else (`gate:request`, package/agent events, updater, bridge) stays
   main-window-targeted — this is the guard against double-handling.
   (`pty.ts` already broadcasts; `bridge.ts`'s `getAllWindows()[0]` must
   become an explicit main-window reference — it is order-fragile today.)
3. **Per-window dirty/editor state.** `editor:dirty-state` and `editor:state`
   handlers key by `event.sender.id`; entries are dropped on window close.
   - Quit guard: `closeGuardDecision(sum of all windows' dirty counts, …)`.
   - Per-pop-out close guard: that window's own count, message
     `You have N unsaved tabs. Close this window anyway?`.
   - `src/main/tools/editorState.ts`: snapshot becomes a merged view — tab
     union with a `window: 'main' | 'popout'` field per tab;
     `activeDocument` comes from the most recently focused window. The tool's
     existing response shape stays backward-compatible (new fields only).
4. **Menu routing.** Editor-scoped commands (`menu:new-document`,
   `menu:open-file`, `menu:save-file`, `menu:save-file-as`,
   `menu:export-document`, `menu:close-tab`, `menu:open-recent`) go to
   `BrowserWindow.getFocusedWindow() ?? mainWindow`. App-scoped commands
   (`menu:settings`, `menu:shortcuts`, `menu:welcome`, `menu:clear-recent`)
   always go to the main window and focus it. Extract the routing decision as
   a pure function (`resolveMenuTarget(command, focusedIsPopout)`) for tests.
5. **`editor.open` / bridge routing.** Before sending `bridge:editor:open` to
   the main window, check the merged editor-state snapshots: if a pop-out has
   the path open, focus that window and send it the open event instead.
6. **Lifecycle.** Main-window `close` → run aggregate guard → close all
   pop-outs → proceed. Workspace switch → guard + close all pop-outs before
   the switch broadcast. `window-all-closed` → quit (unchanged; pop-outs
   can't outlive the main window).
7. **Settings sync.** The settings tools (`src/main/tools/settings.ts`) get a
   change callback (same pattern as skills/account callbacks in `index.ts`)
   that broadcasts `settings:changed`.

### Build config (`electron.vite.config.mjs`)

Renderer `rollupOptions.input` becomes multi-entry:

```js
input: {
  index: resolve(__dirname, 'src/renderer/index.html'),
  popout: resolve(__dirname, 'src/renderer/popout.html'),
}
```

Dev: pop-out loads `${process.env.ELECTRON_RENDERER_URL}/popout.html`;
prod: `loadFile(join(__dirname, '../renderer/popout.html'))`. Same preload for
both windows (it is stateless per-process; verified).

### PopoutShell.vue responsibilities (the whole shell, exhaustively)

1. Register IPC listeners (`editor:adopt-tab`, `bridge:editor:open`,
   `settings:changed`, menu handlers) synchronously before any await.
2. Critical path: `settingsStore.load()` and `kernel.getPort()` run
   concurrently via `Promise.all`; after both resolve, apply theme and set
   port, then call `popoutReady()` to unblock tab delivery.
3. Non-blocking: `session.list` (feeds comments rail "Send to..." picker) and
   `getWorkspace()` (feeds header title) fire-and-forget after readiness —
   they do not gate `popoutReady()`.
4. Render drag header + `<EditorPanel :port="port" window-role="popout" …>`;
   re-apply theme on `settings:changed`.
5. `kernel.on('editor:adopt-tab')` → `editorPanelRef.adoptTab(transferred)`.
6. Wire EditorPanel emits: `sendToTerminal` / `prepareChatDraft` →
   `popout:forward`; `activeFileChanged` → `document.title` +
   `popout:set-edited`; `allTabsClosed` → `window.close()` (after telling main
   to focus the main window).
7. Move-back controls: active-tab button (inside EditorPanel via role) and
   header "move all" (iterates tabs through `popout:return-tab`).
8. Register `menu:*` listeners mapping to the same exposed EditorPanel methods
   `App.vue` uses (`saveActiveFile`, `closeActiveTab`, `createUntitledTab`,
   `openExportDialog`, open-file dialog flow).

What it deliberately does **not** do: no workbench store, no approvals
enqueueing, no toast host wiring beyond a local `ToastHost` for editor
errors, no Navigator, no chat, no terminal.

### EditorPanel changes (kept minimal and role-driven)

- New prop `windowRole?: 'main' | 'popout'` (default `'main'`).
- Tab-strip trailing cluster: pop-out / move-back button per role (next to
  History, identical visual treatment).
- New exposed methods: `serializeTab(index): TransferredTab` and
  `adoptTab(tab: TransferredTab)` — thin wrappers over existing
  `openDocument`/`openFile` plus the pure `editorTabTransfer.ts` helpers
  (selection/scroll capture and restore live there, unit-tested).
- `useEditorTabPersistence` is instantiated only when `windowRole === 'main'`.
- Everything else (all five tab kinds, autosave, conflict bar, inline AI,
  ghost, comments, citations, history rail, preview, shortcuts) runs
  unmodified — this is the point of the design.

## Implementation phases

Each phase lands green (`npm run build && npm run test`) and is independently
shippable. TDD per repo convention: co-located test file first.

**Phase 0 — multi-window plumbing (no UI).**
Broadcast helper + channel switch-over; per-sender keying for
`editor:dirty-state` / `editor:state`; merged `editor.state` snapshot;
aggregate quit guard; `bridge.ts` first-window fix; `settings:changed`
callback. Tests: `editorState.test.ts` (multi-window merge, drop-on-close),
`closeGuard.test.ts` (aggregation), `popoutWindows.test.ts` (registry pure
logic). Pure refactor — the app behaves identically with one window.

**Phase 1 — the pop-out itself.**
Build config entry; `popout.html`/`popout.ts`/`PopoutShell.vue`; window
creation + ack'd tab handshake; `editorTabTransfer.ts`; EditorPanel role prop,
buttons, serialize/adopt; per-window close guard; empty-window auto-close;
workspace-switch and main-close teardown. Tests: transfer round-trip
(dirty/clean/untitled/selection/scroll), `PopoutShell` mount + adopt +
emit-forwarding, EditorPanel role rendering, handshake failure leaves source
tab intact. **End of phase: feature is usable.**

**Phase 2 — cross-window verbs.**
`popout:forward` → `popout:main-command` → `kernelEvents.ts` handlers for
terminal.send (no focus) and prepareChatDraft (focus main); focused-window
menu routing (`resolveMenuTarget` + wiring); session-list load in shell.
Tests: menu target resolution matrix, kernelEvents forwarding handlers.

**Phase 3 — polish.**
macOS `setDocumentEdited` / `setRepresentedFilename`; window title sync;
geometry cascade; command-palette action; `editor.open` routing to the
owning pop-out; live theme re-apply. Tests: palette action presence, open
routing decision (pure), title/edited sync logic.

**Phase 4 — deferred (explicitly out of scope).**
Drag-tab-to-detach; pop-out session restore (`.mim/editor-windows.json` +
geometry); moving tabs into an *existing* pop-out (target picker); approval
diffs surfacing in pop-outs; split pane inside the main window (complementary
feature, unblocked by none of this).

## Docs to update on landing

- `docs/_MAP.md`: Systems row (Renderer — Surfaces: pop-out editor windows),
  file tree (`src/main/windows/`, `src/renderer/popout.*`,
  `components/popout/`), proposals list.
- `docs/document-pane.md`: pop-out role, transfer semantics, persistence rule.
- `docs/workbench-layout.md`: one paragraph — pop-outs live outside the
  Navigator/Work/Artifact model; the Artifact pane contract is unchanged.
- `docs/gotchas.md`: broadcast-vs-targeted channel rule (which channels may
  fan out to all windows and why `gate:request` must not).

## Verification checklist (manual, ask user to confirm visually)

1. Pop out a dirty markdown tab → content, cursor, scroll, unsaved dot carried;
   main window tab gone.
2. Edit + save in pop-out → Files "Changed" updates; main window shows no
   conflict artifacts.
3. Same file opened in both windows → save in one → other reloads (clean) or
   shows ConflictBar (dirty).
4. Cmd+K inline AI and ghost completions inside the pop-out.
5. Cmd+Enter in an R/py chunk in the pop-out → lands in main-window terminal,
   focus stays on the pop-out.
6. Comment → "Send to chat" → main window focused with draft prepared.
7. Cmd+S / Cmd+W / File menu act on the focused window.
8. Close pop-out with unsaved tab → guard prompt; Cmd+Q with dirty pop-out →
   aggregate guard.
9. PDF, CSV table, and image tabs pop out and render.
10. Theme change in Settings → pop-out follows live.
11. Last tab moved back → pop-out closes itself, main window focused.
