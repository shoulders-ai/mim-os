# Agent Sessions

CLI coding agents (Claude Code, Codex, Gemini CLI) are discovered apps, and
each launched agent is a first-class run ("agent session") with an Activity
row, a status lifecycle, persisted record + scrollback, and its own Work
surface. The scratch Terminal fixture is unchanged.

Product rationale: the terminal is never the activity — the agent session is.
The terminal is its rendering surface, the way ChatView renders a chat run.
Scratch shells keep zero ceremony; agent sessions get the full run grammar
(status, rename, archive, stop, history). Typing `claude` manually in a
scratch terminal tab is not promoted into a session.

## Concepts

| Concept | Maps to |
|---|---|
| Detected CLI agent | App (capability) launcher row in the Navigator Apps section |
| Agent session | Run: Activity row + `agent-session` Work entry |
| Scratch terminal | Unchanged fixed Terminal fixture, multi-tab panel, no Activity rows |

An agent session is the closest sibling of an app run: persisted record,
status lifecycle, boot-time stale reconciliation, close-guard participation,
archive/History membership. `agentSessions.ts` deliberately mirrors
`packageJobs.ts` shapes. Agents are **not** apps: no `app.status` rows,
no trust layers. Launcher visibility is **opt-in**: a row appears iff the
binary is installed on this machine **and** the user enabled the agent in
Settings → Agents (the `enabledAgents` workspace setting,
default `[]` — detection alone never surfaces a launcher). The toggle gates
visibility only: it never installs or launches anything, and existing session
records, resume, Activity rows, and History are unaffected by toggling off.

## Main Process

| File | Owns |
|---|---|
| `src/main/agents/agentCatalog.ts` | Static catalog (`claude-code`, `codex`, `gemini-cli`) + installation detection. `resumeArgs(agentId, cliSessionId?, cwd?)` returns per-agent CLI flags for deterministic resume: `--resume <id>` for Claude Code, `resume <uuid>` for Codex, `--session-file <path>` for Gemini CLI — all falling back to most-recent semantics when no `cliSessionId` is detected. `cliSessionsDir(agentId, cwd)` returns the session storage directory for Claude Code (`~/.claude/projects/<encoded-cwd>/`) and Gemini (`~/.gemini/tmp/<basename>/chats/`); Codex uses a date-based path computed at snapshot time. `extractCodexSessionId(filename)` extracts the UUID from Codex rollout filenames. No Electron imports. |
| `src/main/agents/agentSessions.ts` | Session lifecycle service (`createAgentSessions`): launch/resume/stop/list/get/rename/archive/delete, persistence, scrollback capture, event emission, `reconcileStaleSessions`, `activeSessionCount`. `launch()` snapshots the agent CLI's session directory before spawn and detects the new session file on first PTY output, storing it as `cliSessionId` on the record. `resume()` spawns the agent with `resumeArgs` using the detected `cliSessionId` for deterministic resume. System boundaries (pty spawn factory, MCP token/port providers, emit, clock, id generator) are injected. |
| `src/main/agents/agentStatus.ts` | Pure runtime-status tracker over the pty output stream (see Status signals). Dependency-free, chunk-split-safe escape-sequence parser. Derives `idle` from a 5-second timeout after entering `needs-input`. |
| `src/main/tools/agents.ts` | Registers the `agent.*` tools over injected detect/sessions deps. |
| `src/main/pty.ts` | Shared `spawnPtyProcess` helper used by both `terminal.spawn` and agent sessions: every pty lives in the same instances map and forwards on the same `pty:output:<id>` / `pty:exit:<id>` channels. Renderer keystrokes use a fast-path `pty:input` IPC channel (`writePty`) that bypasses the tool registry; the `terminal.write` registry tool remains for programmatic use (bridge commands, AI/app callers). `terminal.spawn` opts scratch zsh shells into `ptyShellIntegration.ts` for keymap bindings; agent sessions do not opt in. `terminal.resize/kill` and renderer xterm attachment work uniformly on both scratch and agent ptys. |
| `src/main/closeGuard.ts` | `closeGuardDecision(dirtyTabCount, activeRunCount, activeAgentCount)` — third count produces "N running agent sessions" in the quit prompt. |
| `src/main/index.ts` | Wiring: `createAgentSessions({ getWorkspacePath, spawnPty: spawnPtyProcess, getMcpServerPort, createMcpToken, revokeMcpToken, emit })` (emit sends to the main window and broadcasts on the app server), `reconcileStaleSessions()` at boot, `registerAgentTools(tools, { sessions })`, agent count into the close guard. |
| `src/main/tools/archive.ts` | `archive.list` also returns `agentSessions` — archived records read straight from their files so the tool works without the live service (headless). |

Launched agent ptys receive `MIM_PORT` and a per-session `MIM_TOKEN` in their
environment. This lets their configured `mim mcp` server connect back to the
running desktop with trace/audit attribution to the agent session. The token is
revoked on normal exit, stop, or launch failure after token creation.

### Record and persistence

Records live at `.mim/agent-sessions/<sessionId>.json`, written via
`atomicWriteJson` on every transition. Scrollback is a sibling
`<sessionId>.scrollback` raw append file.

```ts
interface AgentSessionRecord {
  sessionId: string
  agentId: string
  title: string          // defaultTitle: agent name, then "Name 2", "Name 3", ...
  command: string        // absolute binPath + args
  cwd: string            // workspace root
  status: 'running' | 'done' | 'error' | 'stopped' | 'interrupted'
  startedAt: string
  endedAt?: string
  exitCode?: number
  archived?: boolean
  titleHint?: string     // last OSC 0/1/2 title; persisted on change
}
```

`AgentSessionRuntime` = record merged with live-only overlay fields for the
renderer: `ptyId` (attach xterm to the running pty), `runtimeStatus`
(`working` / `needs-input` / `idle`), and optionally `scrollback`. The overlay
is never persisted.

Status transitions:

- launch → `running`.
- pty exit → `stopped` if a stop was requested (`stopRequested` flag set before
  `handle.kill()`, classifying the exit regardless of its non-zero exit code),
  else `done` (exit 0) or `error` (non-zero).
- `stop` on a stale `running` record with no live pty → `stopped` directly.
- `reconcileStaleSessions()` at boot: any `running` record without a live pty
  becomes `interrupted` (ptys die with the app).
- `delete` throws while the session is running; for ended sessions it removes
  record + scrollback, and repeat deletes of an already-missing record are
  treated as already done.

Corrupt record files are quarantined, never poison list/get: renamed to
`<file>.corrupt` with a `console.error` (same convention as `sessions.ts`).

### Scrollback

Captured in the main process from the same `onData` hook that forwards pty
output, so it works even if the renderer never mounted the session. Byte-cap:
when the file exceeds 2 MiB (`SCROLLBACK_MAX_BYTES`) it is rewritten keeping
only the most recent 1 MiB (`SCROLLBACK_KEEP_BYTES`) — coarse front
truncation; xterm replay resynchronises on the next escape sequence.

### Status signals (`agentStatus.ts`)

`AgentRuntimeStatus = 'working' | 'needs-input' | 'done' | 'idle'`

Three signal layers, highest priority wins within a single `feed()` call:

**Layer 1: OSC 9;4;N; — terminal progress protocol** (Claude Code):
- `4;3;` (indeterminate progress) → `working`.
- `4;0;` (progress removed) → `done`.

**Layer 2: Title spinner prefix** (Claude Code, Codex, Gemini CLI):
- Title gains a spinner prefix character → `working`.
- Title loses a spinner prefix character → `needs-input`.
- Spinner characters: Braille block (U+2800–U+28FF, animated frames) and
  ✦ U+2726 (Gemini CLI static working indicator). Detected by
  `isSpinnerPrefix()`.

**Layer 3: OSC 777 — desktop notification** (Claude Code):
- Any `OSC 777` payload → `needs-input`. Sets `needsInputIsBlocking` so
  the state does not degrade to idle (genuinely waiting on user approval).

**Fallback** (agents with none of the above):
- BEL (`\x07`) in plain text → `needs-input`.
- Printable output → `working`.

Once any TUI signal (OSC 9, title spinner, or OSC 777) is seen,
`hasTuiSignals` is set and printable output no longer drives status.

**Idle derivation** (time-based, not signal-based):
- `done` + 5 s silence → `idle`.
- `needs-input` + 5 s silence → `idle`, **unless** `needsInputIsBlocking`
  (set by OSC 777 — the agent is genuinely waiting on user permission and
  should stay visible as "Input").

**Per-agent signal summary:**

| Agent | Working signal | Done signal | Needs-input signal |
|---|---|---|---|
| Claude Code | OSC 9;4;3; + Braille title | OSC 9;4;0; | Title ✳ (plan mode) / OSC 777 (permissions) |
| Codex | Braille title prefix | Title loses Braille | — (degrades to idle) |
| Gemini CLI | ✦ title prefix | ◇ title prefix | — (degrades to idle) |

### Events

`agent:session-event` (sent to all windows + broadcast on the app
server) carries `{ type, session }` where `session` is the full
`AgentSessionRuntime`:

| Type | Emitted on |
|---|---|
| `session.started` | launch |
| `session.status` | runtime status or titleHint change |
| `session.exited` | pty exit (and stale-stop transition) |
| `session.changed` | rename, archive/restore |
| `session.deleted` | delete; carries the removed record so listeners prune by id |

The renderer upserts lifecycle/change events and prunes on `session.deleted`.
Do not treat delete as a generic change event, or a deleted record can be
reinserted into Activity with no backing `.json`/scrollback file.

### Tools

| Tool | Effect | Notes |
|---|---|---|
| `agent.list` | read | Detected agents with absolute `binPath` (login-shell resolution, cached) |
| `agent.launch` | mutate | Spawns the agent as an interactive pty in the workspace root; returns `{ session, ptyId }`. **User-only**: hard-denied to the `ai` actor before any approval or developer bypass (like `app.trust`) |
| `agent.stop` | mutate | Records the session as `stopped`. **User-only**, same hard deny |
| `agent.sessions.list` | read | Non-archived records merged with live runtime state |
| `agent.sessions.get` | read | One record; `scrollback: true` includes the captured text |
| `agent.sessions.rename` | mutate (ui/low) | Trimmed non-empty title |
| `agent.sessions.archive` | mutate (ui/low) | `archived: false` restores |
| `agent.sessions.delete` | mutate (ui/medium) | Removes record + scrollback; fails while running; repeat delete of an already-missing ended session is idempotent |

The **whole `agent.*` surface is denied to app actors** — agent sessions
run with the user's full shell authority. Policies live in `TOOL_POLICIES`
and the hard-deny branches in `src/main/security/gate.ts`; see
[security.md](security.md).

## Renderer

| File | Owns |
|---|---|
| `src/renderer/stores/agents.ts` | Detected-agent catalog mirror (`agent.list`); `enabledAgents` (installed ∩ user-enabled) for launcher rows, `isEnabled`/`setEnabled` persisting the `enabledAgents` setting; error-tolerant refresh keeps the last known catalog |
| `src/renderer/stores/runs.ts` | `agentSessions` state + `agent-session` `NavigatorRun` kind. Status mapping: `running` + runtime overlay → `working`/`needs-input`/`idle`; `interrupted` maps to `error` (mirrors app jobs boot reconciliation); rename via `agent.sessions.rename` |
| `src/renderer/services/workbench/entries.ts` | `agentSessionWorkEntry(agentId, sessionId, title)` → id `work:agent-session:<sessionId>` (identity is the session id alone; agentId rides along for the view) |
| `src/renderer/services/workbench/hosts.ts` | `agent-session` Work host kind |
| `src/renderer/components/terminal/TerminalSurface.vue` | One xterm instance bound to one pty (live) **or** replaying a static scrollback string (replay). Extracted from `TerminalPanel.vue`, which keeps tabs, spawn ownership, and restart semantics for scratch terminals. Uses the profile-aware keybinding fallbacks in `terminalKeybindings.ts`. |
| `src/renderer/components/agents/AgentSessionView.vue` | The `agent-session` Work surface: header with title/status/subtitle, Stop while running, live `TerminalSurface` bound to `ptyId` with the agent id as keybinding profile, ended banner (Exited / Failed (exit N) / Stopped / Interrupted) + Resume (resumes the same session via the agent CLI's native resume flag), scrollback replay fetched once per ended session and re-fetched after a resumed session ends again, missing-record recovery state |
| `src/renderer/components/workbench/WorkHost.vue` | Mounts `AgentSessionView` for `agent-session` Work |
| `src/renderer/components/sidebar/ShellSidebar.vue` | Apps section: launcher rows for enabled agents (IconRobot) after app launchers, participating in `navigatorAppOrder` (plain ids; catalogs cannot collide). Launcher rows are pure launchers — every click spawns a new session, never "active". Activity: agent-session rows with status; context menu (`RunContextMenu.vue`) offers Stop only on live sessions and Delete only on ended ones; batch archive includes agent sessions, batch delete skips live ones |
| `src/renderer/App.vue` | Adapter: hydrates `agentsStore` + `runsStore.agentSessions` at boot and on workspace switch (`agent.list` + `agent.sessions.list`), subscribes `agent:session-event`, launch/open/stop/archive/delete handlers; archive and delete prune the matching Work history entry and fall back to Files Work when the pruned entry was active |
| `src/renderer/components/archive/ArchiveBrowser.vue` | History shows active and archived agent sessions; Open on an archived one un-archives it and reopens `agent-session` Work; Delete calls `agent.sessions.delete` |

## UX surfaces

- **Settings → Agents**: one row per catalog agent (name, `binPath` or
  "Not installed"), a toggle per installed agent writing `enabledAgents`.
  Not-installed agents render dimmed with a disabled toggle. Each installed
  agent has a collapsed "Flags" disclosure with a free-text input for custom
  CLI flags (e.g. `--dangerously-skip-permissions`, `--model o3`), persisted
  per workspace as `agentFlags: Record<string, string>` and appended to the
  launch command as `extraArgs`.
- **App launcher rows**: one row per enabled installed agent, robot icon,
  click = launch a new session and open its Work surface.
- **Activity rows**: one row per non-archived session, status dot/tag
  (`working`, `needs-input`, `idle`, `done`, `stopped`, error for both `error`
  and `interrupted`); click opens `work:agent-session:<id>`; inline rename;
  Stop (live only), Archive, Delete (ended only).
- **AgentSessionView**: live terminal while running with agent-specific
  keybinding profile; ended banner + Resume + scrollback replay after;
  "Session not found" recovery if the record is gone.
- **History**: agent sessions appear next to chats and app runs,
  archived previews come from `archive.list` (`titleHint` as preview).
- **Close guard**: running sessions add "N running agent sessions" to the
  quit confirmation.

## Tests To Update With Agent-Session Changes

- `src/main/agents/agentCatalog.test.ts`
- `src/main/agents/agentSessions.test.ts`
- `src/main/agents/agentStatus.test.ts`
- `src/main/tools/agents.test.ts`
- `src/main/closeGuard.test.ts`
- `src/main/security/gate.test.ts` (agent policy + user-only denials)
- `src/renderer/stores/agents.test.ts`
- `src/renderer/stores/runs.test.ts`
- `src/renderer/components/agents/AgentSessionView.test.ts`
- `src/renderer/components/terminal/TerminalSurface.test.ts`
- `src/renderer/components/terminal/terminalKeybindings.test.ts`
- `src/renderer/components/terminal/xtermKeyboardEncoding.test.ts`
- `src/renderer/components/sidebar/ShellSidebar.smoke.test.ts`
- `src/renderer/components/archive/ArchiveBrowser.smoke.test.ts`
- `src/renderer/components/settings/AgentsSettingsPanel.test.ts` (Coding agents settings)
- `src/main/tools/settings.test.ts` + `src/renderer/stores/settings.test.ts` (`enabledAgents`)

Run `npm run test -- agents agentSessions agentStatus closeGuard
AgentSessionView TerminalSurface` for a focused pass, then
`npm run build && npm run test`.
