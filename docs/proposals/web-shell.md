# Web Shell

Status: superseded by [Mim Restructure](team-source.md). The browser team-space,
remote editing, and remote terminal tracks below are no longer the product
roadmap.

Open a team space in a browser tab. No install, no local files, no setup — an
invite link becomes a live Mim: team chat with approvals, the team Board and
Knowledge, files with presence, run history, and a review queue you can clear
from a phone. This proposal is the charter for the mim-serve strategic tracks
A (thin-client editing), B (remote terminal), C (async review queue), and D
(browser shell), and for the north-star renderer migration they all depend on.

The product stance: **desktop Mim stays the power shell** — local folders,
local ptys, local CLI agents, native chrome. The web shell is the zero-install
membrane around a team space: the way a teammate, a reviewer, or the PI on a
train participates without adopting the desktop workflow first. One kernel,
one tool registry, one gate, one trace stream; the browser is just another
shell on the same service.

## Why the Migration Is Smaller Than It Looks

The mim-serve proposal treats "every UI becomes a client" as a distant target.
A code inventory says it is mostly already true:

- **Tool dispatch is one choke point.** The renderer touches no filesystem and
  no Node API. Nearly all renderer↔main traffic is
  `window.kernel.call(tool, params)` — serializable JSON through a single
  preload method (`src/preload/index.ts`) into the tool registry. Swapping the
  transport under that one seam carries the overwhelming majority of every
  surface: editor, files, history rail, Board/Knowledge, settings, sessions.
- **Chat is already a network protocol.** Desktop chat does not stream over
  IPC. It POSTs to `/api/ai/chat` on the local Express server and consumes the
  Vercel AI SDK UI-message SSE stream (`ChatView.vue` via
  `DefaultChatTransport`; `server.ts`). The renderer already injects a base
  URL and an auth header on every AI fetch (`services/ai/aiApi.ts`). Pointing
  chat at a remote team space is a URL and a token, not a rewrite.
- **Event push half-exists.** Main already dual-broadcasts most push events to
  the Electron window *and* the server's WebSocket clients
  (`broadcastToRenderers` in `src/main/index.ts`). The WS protocol already has
  request framing, event push, reconnect, and a replay buffer with `lastSeq`
  catch-up (`server.ts`, `sdk/mim.js`).
- **Stale-write safety is server-side.** `fs.read` returns a content hash;
  `fs.write` verifies `expected_hash` and rejects conflicts
  (`src/main/tools/fs.ts`). The editor only stores and echoes the hash — thin
  clients inherit conflict safety for free.
- **The pty protocol is transport-agnostic.** Spawn/write/resize/kill are tool
  calls; output/exit are pushed string/number payloads; keystrokes are a
  fire-and-forget message. node-pty lives entirely server-side. Agent-session
  scrollback already persists server-side.
- **Multi-shell is proven.** Pop-out editor windows are a second Vue shell
  sharing the same kernel, with a pure-JSON tab-transfer protocol
  (`editorTabTransfer.ts`) including dirty content and stale-write hashes.

The genuinely missing piece is exactly one thing: an **authenticated Shell
API** — the protocol a human member's shell speaks to a team space, distinct
from MCP (the protocol an agent or automation speaks). Everything else is
feature-gating the Electron-only residue: native dialogs, Finder reveal,
drag-drop absolute paths, auto-update, pop-out window lifecycle, menu events.

## Architecture

### Two front doors, one kernel

| Door | Caller | Protocol | Surface |
|---|---|---|---|
| `/mcp` | Agents, CI, automation | MCP streamable HTTP | Tool catalog only |
| Shell API | Human members via a shell | WS + HTTP SSE + blob routes | Tools + events + chat streaming + files + approvals + presence |

Both doors authenticate against the same serve caller store, dispatch as
`actor: 'remote'`, resolve the same grants, and land in the same trace stream
with the same principal attribution. A caller record gains a
`kind: 'agent' | 'member'` field; member tokens unlock the Shell API, agent
tokens do not. The desktop MCP stdio bridge and desktop-local routes are
unchanged.

### The Shell API

One WebSocket connection per shell session, plus HTTP for streaming and blobs:

- **Hello/handshake.** On connect, the shell authenticates (bearer) and
  receives server version, Shell API version, capability flags, workspace
  identity, and the caller's own identity and grant summary. Version skew
  warns before mounting, mirroring the existing MCP `initialize` check.
- **Tool calls.** The existing WS framing (`{id, method, params}` →
  `{id, result | error}`) carries `kernel.call` unchanged, dispatched as the
  member's `remote` identity through the gate.
- **Events.** Topic-based subscription with the existing replay-buffer
  pattern: `workspace:files-changed`, `sessions:changed`, `gate:request`,
  `presence:changed`, `routines:changed`, catalog changes. The kernel emits
  session-write events (new — today session changes have no push anywhere;
  desktop gains from this too).
- **Chat streaming.** The same UI-message SSE contract as `/api/ai/chat`,
  mounted for member callers in serve mode. The desktop shell-token route
  stays desktop-only; serve mode gets member-authenticated AI routes instead
  of a lifted 404.
- **Approvals.** The gate's approval surface becomes a registry instead of a
  hardwired Electron window send. Desktop registers the IPC surface; a member
  shell connection registers a socket surface scoped to runs it initiated.
  `PermissionApprovalRequest` and the decision reply are already pure JSON.
  Unanswered remote approvals time out to deny (and, once the review queue
  exists, to a staged proposal instead).
- **Files.** `/workspace-files/*` gains member auth in serve mode for binary
  reads (PDF viewer, downloads with `Content-Disposition`); an upload route
  replaces native file dialogs and drag-drop path extraction (browsers upload
  bytes; they cannot reveal local paths). Text editing stays on
  `fs.read`/`fs.write` with hashes.
- **Presence.** Members report open-file activity on a heartbeat; the server
  keeps a decaying ledger and broadcasts `presence:changed`. Presence is
  advisory — a soft "Anna is editing draft.md" chip, never a lock; correctness
  stays with stale-write hashes, exactly as the mim-serve track A sketch
  specifies.

### The KernelClient seam

The renderer gets one interface where `window.kernel` is used today:
`KernelClient` — `call`, `on`/`off`, gate responses, plus the bootstrap
getters. Two implementations:

- **IpcKernelClient** wraps the existing preload bridge. Desktop default;
  zero behavior change.
- **SocketKernelClient** speaks the Shell API. The browser shell uses it
  exclusively; desktop can dogfood it against localhost behind a dev flag,
  which is the concrete first step of the north-star renderer migration and
  the eventual exit ramp from Electron.

Electron-only affordances hide behind capability flags from the handshake
(native dialogs, reveal-in-Finder, open-with-native-app, pty, pop-outs,
auto-update) rather than platform sniffing. In the browser: dialogs become
upload/download, reveal becomes download, auto-update becomes a refresh
banner, pop-outs are deferred, the native menu simply doesn't exist (its
handlers are already ordinary renderer functions).

### Identity

Phase one: member tokens are serve caller tokens with `kind: 'member'`,
minted by the same invite flow — the browser variant is a `/join` page on the
team-space host where the invite paste string redeems into a token held by
the SPA (same single-use exchange as desktop join). mim-serve phase 3
(mim-web issued identity) later becomes the login/SSO layer; nothing here may
assume local-only token administration, and nothing here waits for it.

## Phases

Each phase is a shippable product moment in the same browser app; the tab
ships early and gains capabilities in place.

### Phase 0 — Shell API foundation

- `KernelClient` interface extracted in the renderer; IpcKernelClient default.
- Serve-mode Shell API: member caller kind, WS hello/auth, tool-call framing,
  topic events with replay, capability flags, version handshake.
- Kernel emits session-change events; desktop Navigator/History consume them
  too (removes today's refresh-after-own-turn-only behavior).
- Gate approval-surface registry (desktop IPC surface registered as one
  implementation; behavior unchanged).
- Route matrix updated: shell routes are a serve-mode class with member auth,
  tested like the MCP matrix.

Outcome: no user-visible change; a member token can call tools and receive
events over the Shell API in tests.

### Phase 1 — Browser shell, read-mostly

- Serve mode hosts the built renderer bundle; `/join` page redeems an invite
  in the browser.
- SocketKernelClient boots the SPA against the team space; Electron-only
  surfaces hidden by capability flags.
- Live read surfaces: session History (including running turns via session
  events), Board/Knowledge/References, Files browsing and reading (text, PDF,
  images), routines list, traces/Monitor.

Outcome: the first wow — an invite link opens the team space in a browser
tab, and a running overnight session can be watched live from a phone.

### Phase 2 — Thin file editing and presence (track A)

- `fs.write` with stale-write hashes over the Shell API; conflict bar works
  as on desktop.
- Watch/unwatch as event subscriptions; open tabs react to remote changes.
- Presence heartbeats, decaying server ledger, soft-lock chips in the editor.
- Uploads and downloads replace native dialogs and reveal.

Outcome: a member edits team-space files directly in the browser with
conflict safety and presence, zero local files — the Google Docs / VS Code
Remote mental model.

### Phase 3 — Chat in the browser

This phase is the client side of mim-serve phase 4 (unattended/remote runs)
and should land with it.

- Member-authenticated AI chat routes in serve mode, streaming the same
  UI-message SSE protocol; abort on disconnect (already the server's
  behavior) plus explicit stop.
- Caller identity and grants propagate through the model tool loop; every
  tool call the model makes is gate-checked against the member's grants; cost
  attribution per caller on every run.
- Remote approvals: `gate:request` events to the initiating shell, decisions
  posted back, timeout-to-deny. Session persists as a normal team-space
  session, visible in desktop History.

Outcome: full Mim chat from a browser tab — ask the team's agent to read the
draft, search team knowledge, and file issues, approving its actions inline.

### Phase 4 — Review queue (track C)

Approval as pull request, not sudo prompt. The gate gains a third outcome
besides allow/deny: **stage**.

- A staged proposal records caller, tool, params, and a human-reviewable
  preview: a content diff for file writes, a structured op summary for named
  app-tool mutations, the held payload for outbound messages (Slack posts).
  That effect triad is the v1 stageable set; everything else stays
  allow-or-deny.
- Producers: unattended runs (routines, agent callers) whose policy says
  stage-over-deny; remote member runs whose approval timed out; member
  actions above their grant ceiling but within a stageable class. This also
  resolves the executable-floor-versus-human tension: floor-protected writes
  (skills, routines, instructions) can become staged proposals for an
  operator instead of hard walls for members.
- Reviewing: a queue surface in every shell — diff, apply, discard. Apply
  re-checks stale-write hashes and executes under the reviewer's authority
  with dual attribution (proposed-by, approved-by) in the trace.
- Storage is team-space state, written by the kernel, covered by backups.

Outcome: overnight runs execute to completion against a policy ceiling and a
human clears the queue from any shell in the morning — the flagship demo
from mim-serve becomes reviewable instead of pre-trusted.

### Phase 5 — Remote terminal and agent sessions (track B)

- Pty spawn/write/resize/kill over the Shell API; output/exit as events;
  keystrokes as fire-and-forget messages. TerminalSurface renders the byte
  stream unchanged.
- Server-hosted CLI agent sessions with existing scrollback persistence and
  replay.
- Hard-gated: a pty is the server account's full Unix authority, so this is
  an explicit per-member operator grant, off by default, and lands only after
  the grant model has survived phases 1–4 in production.

Outcome: "agents outlive laptops" for interactive work; SSH stops being the
only answer.

## Enabling Moves in Current Serve Work

Small decisions in the ongoing serve hardening that keep this proposal cheap
instead of foreclosing it:

- Add `kind: 'agent' | 'member'` to serve caller records now; default
  existing records to `agent`.
- Treat `/mcp/events` as the last single-purpose SSE channel; new event needs
  go to the topic-based shell channel design rather than more one-off streams.
- Fix the remote-write deny floor to cover `.mim/**` (tool policy, folder
  links, sessions, traces) — already flagged in review; it becomes more
  urgent once member tokens exist.
- Introduce the gate approval-surface registry when touching gate plumbing,
  even with only the desktop IPC surface registered.
- Emit kernel session-change events server-side; they are useful to desktop
  immediately and required by phase 1 here.
- Keep route gating keyed on `ServerMode` with the shell routes as a third
  tested class, never on peer address.

## Security Considerations

- **Members are still `remote`.** No shell route may bind `user`. Member
  grants are broader than agent grants by default but resolve through the
  same gate, floors, and trace attribution.
- **The browser is a hostile rendering context.** The SPA renders
  model-generated markdown and workspace content; the web shell ships with a
  strict CSP, no third-party origins, and app iframes disabled until a
  sandboxing story exists. Bearer tokens live in the SPA (no cookies — no
  CSRF class); the app is same-origin with its API.
- **Approval integrity.** Approval requests route only to the shell
  connection of the caller whose run raised them; decisions are accepted only
  from that principal; timeouts deny. The review queue applies changes under
  the reviewer's authority with dual attribution.
- **File routes are grant-checked.** Authenticated `/workspace-files` and
  uploads resolve through the same path classifier, deny floors, and grant
  scopes as `fs.*` tools — a blob route is not a side door.
- **Rate limits and body caps** from mim-serve phase 1 apply per member
  token, including SSE/WS connection counts.
- **Presence is metadata.** It leaks who-is-working-on-what to all members by
  design; it carries no content and respects revocation immediately (ledger
  entries die with the token).
- **Terminal is a separate trust tier.** Phase 5 grants are explicit,
  per-member, operator-issued, and logged; there is no bundled
  "member = shell access."

## Explicitly Not Building

- Real-time collaborative editing or CRDTs (inherited refusal — presence,
  soft locks, stale-write hashes, and the conflict card are the ceiling).
- Offline-first browser mode; the web shell assumes a reachable team space.
- Native mobile apps; the web shell should merely be usable on a phone.
- Multi-tenant SaaS; one team space, one trust boundary, as before.
- Replacing desktop Mim; local folders, local agents, and native chrome stay
  the desktop's job.
- App iframe hosting in the web shell v1 (deferred until a network sandbox
  story exists, per mim-serve).
- Pop-out windows in the browser v1 (browser tabs + BroadcastChannel is
  plausible later; deferred).

## Open Questions

- **Member grant defaults.** What does the standard member template allow —
  read-everything plus stageable mutations, or an operator-chosen preset per
  invite? Leaning: opinionated default template, operator-editable.
- **Settings surface in the web shell.** Which settings are meaningfully
  server-owned (theme is client, tool policy is operator, model default is
  whose?) — needs a pass before the Settings dialog appears in the browser.
- **Session ownership and visibility.** Are all team-space sessions visible
  to all members, or scoped by creator with sharing? V1 leans team-visible,
  matching the shared-trace posture.
- **Chat transport unification.** Should desktop chat eventually use the
  Shell API streaming route instead of the shell-token `/api/ai/*` pair, or
  do the two coexist indefinitely?
- **Multiple team spaces per browser.** One tab per space is the base model;
  is a space switcher inside one tab worth it?
- **PWA touches.** Installable manifest and icon are cheap; anything beyond
  (background sync, notifications) needs demonstrated demand.

## Relationship to Sibling Proposals

- [mim-serve.md](mim-serve.md) — this proposal charters its strategic tracks
  A–D and the north-star renderer migration; it depends on serve phases 0–2
  (landed) and supplies the client side of phase 4. Track E (managed replica
  sync) remains separately chartered there.
- [context-compaction.md](context-compaction.md) — required for long
  unattended runs surfaced in phases 3–4 here.
- [routines.md](routines.md) — routines are the main producer for the phase 4
  review queue.
