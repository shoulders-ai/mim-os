# Mim Serve

Status: proposal.

`mim serve` runs a headless Mim on a machine that stays awake - team infra, a
tailnet node, or a small cloud box - hosting one workspace continuously and
serving it to desktop Mims, CLI agents, and automations. It is not a separate
server product. It is the same kernel, the same tool registry, the same
permission gate, and the same trace stream, booted without Electron and
reachable over a controlled network.

The user-facing noun is **shared workspace**: a workspace hosted by another Mim.
"Server" stays operator vocabulary for the CLI, process model, and deployment
docs.

## North Star

Mim's long-term shape is a service with shells, not a desktop app with a
server bolted on:

- **The kernel is a server.** Tool registry, gate, trace, sessions, AI
  runtime, and app runtime run in a plain Node process. Electron is one way
  to give it a screen.
- **Every UI becomes a client.** Target architecture, not current state:
  today the renderer reaches the kernel over preload IPC
  (`window.kernel.call`); only app iframes use the server door. The target is
  that every shell — desktop renderer included — speaks the server API,
  making desktop Mim a bundled localhost server plus a UI shell and
  `mim serve` the same server with the network turned on. That renderer
  migration is its own future proposal; nothing in phases 0-4 depends on it.
  It is also the exit ramp from Electron: any shell (Electron, Tauri, a
  browser tab) can sit on the same service.
- **Local-first means the server is yours.** By default it runs on localhost
  and works offline. A hosted shared workspace is the same process on a
  machine that stays awake — not a different product.
- **Compute lives with the workspace.** Files, terminal ptys, code execution,
  and agent runs happen on the machine that hosts the workspace, never
  mimicked across machines. Clients render streams; git moves replicas.

Phases 0-4 below are deliberately incremental and are the committed plan.
The strategic-direction section sketches the rest of the road so near-term
decisions don't foreclose it.

## Principles

- **One kernel.** `mim serve` = `createHeadlessKernel()` + `createServer()` with
  serve-mode options. No forked codebase, no parallel tool implementations, no
  server-only data model. The server's only special privilege is uptime.
- **Desktop compatibility is non-negotiable.** Existing desktop boot, local
  WebSocket app runtime, `mim mcp`, `~/.mim/server.json`, `MIM_PORT`, and
  `MIM_TOKEN` keep their current behavior unless the user explicitly configures
  a shared workspace.
- **Policy replaces presence.** The desktop approval gate assumes a human at
  the screen. A shared workspace has no screen, so approval becomes a
  declarative per-caller policy of allowed tools, effects, and path scopes.
  There is no serve-mode "allow everything" switch.
- **Attribution before capability.** Every remote call carries an issued caller
  identity, and every trace event produced by that call carries the same
  identity. A team cannot share a workspace it cannot audit.
- **The workspace stays the unit.** One process hosts one workspace: files,
  `.mim/`, apps, skills, issues, knowledge, traces. A colleague can still read
  the folder without Mim.
- **MCP is the front door.** The public surface is MCP over streamable HTTP.
  Desktop-only WebSocket routes remain for local app iframes and the local MCP
  stdio bridge; they are not the public remote API in phase one.

## Context - what exists

Nearly all of the machine already runs without Electron:

- **Headless kernel.** `createHeadlessKernel()` (`src/main/headless.ts`) boots
  the full tool registry - files, git and managed sync, sessions, search,
  trace, web, documents, skills, AI, app runtime with named tools and agent
  mounts, integrations - plus a permission gate, trace log, local history, and
  telemetry. The headless CLI (`src/main/cli.ts`) already ships it as
  `mim tool`, `mim orient`, and `mim mcp`. Headless today does not start the
  server and writes no discovery file.
- **Unavailable headless capabilities.** PTY/terminal, CLI agent sessions,
  renderer bridge tools (`editor.open`, `chat.send`, `editor.state`), native
  file dialogs, hidden-BrowserWindow PDF rendering, live browser sessions, and
  currently-unwired resource mounts depend on Electron, a local display, or
  desktop-only boot wiring. Serve mode must omit or self-report these rather
  than list broken tools.
- **The server.** `createServer()` (`src/main/server/server.ts`) is Express +
  WebSocket, created only in Electron boot (`src/main/index.ts`), bound to
  `127.0.0.1` on a random port. It has three local token classes: a per-boot
  shell token for `/api/ai/*`, per-iframe launch tokens, and MCP bearer tokens.
  Desktop MCP discovery is `~/.mim/server.json` (`{port, token}`, mode 0600),
  overridable via `MIM_PORT`/`MIM_TOKEN`.
- **The MCP catalog is the external API shape.** `MCP_TOOL_SPECS`, dynamically
  registered named app tools (`issues.*`, `knowledge.*`, `references.*`), and
  conditional integration tools are already filtered by workspace tool policy.
  The local stdio bridge is a protocol adapter over WebSocket; serve mode adds
  an HTTP transport over the same catalog rules.
- **The AI runtime is renderer-free.** `streamChatResponse` and mounted
  `AgentProfile`s run in main. Phase four can run server-hosted agent turns,
  but only after caller identity and grants propagate through every nested
  model tool call.
- **Identity infrastructure is partial.** The private registry already proves
  hash-stored one-time tokens, entitlements, revocation, and validation. The
  trace stream has a `principal` field, and MCP connections can set
  `ctx.agent`, but per-call caller identity is not currently stamped through
  the registry. Serve mode must add this before it exposes remote mutation.
- **The gate assumption changes.** MCP connections today bind as
  `actor: 'user'` because the desktop MCP token proves same-machine,
  same-human access. That assumption does not survive the network.

## Motivation

Mim's audience is small research organisations: teams of researchers whose
work is files - protocols, models, manuscripts, extraction tables - and whose
tooling is increasingly agents. Today each Mim is an island. The workspace
lives on one laptop; issues and knowledge are shared only as fast as git sync;
agents die when the lid closes.

An always-on shared workspace gives the team:

- **Shared team memory.** Knowledge and issues have one authoritative copy.
  A teammate's CLI agent asks `knowledge_search` and gets the same answer the
  PI's desktop Mim gets.
- **A single writer for structured state.** Issues and knowledge are
  file-backed. A shared workspace can turn concurrent writes into a request
  queue instead of git conflicts between clones, but only after the server
  serializes app-data writes and desktop replicas route server-owned tool
  namespaces back to the shared workspace.
- **Agents that outlive laptops.** Literature monitors, nightly extraction
  checks, and referee passes need a host, not a foreground desktop.
- **Team audit.** Every remote call - human, desktop Mim, CLI agent, CI job -
  lands in one trace stream with caller identity attached.
- **A front door for automation.** CI can file an issue when a pipeline fails;
  Slack workflows can append to the logbook; routines can trigger agent runs
  under predeclared grants.

## Conceptual Architecture

### The command

```bash
mim serve --workspace /srv/hta-model --host 100.64.0.7 --port 4780
```

`mim serve` boots a headless kernel, opens one workspace, then starts the same
server module in serve mode. One process hosts one workspace; a team with
three shared workspaces runs three processes. That keeps the trust boundary,
policy file, trace stream, and supervision story simple.

Defaults are conservative:

- No `--host` means loopback.
- Binding beyond loopback requires an explicit `--host`.
- Serve mode refuses to start until at least one caller token exists,
  regardless of bind address — behind the reference proxy a loopback bind is
  still fully public.
- The public phase-one network surface is `/mcp`; app iframe and shell routes
  are local-only or disabled.

### Transport

The public door is **MCP over streamable HTTP** at `/mcp`.

```json
{
  "mcpServers": {
    "team": {
      "url": "https://mim.tailnet.example/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

The implementation should share MCP request handling between stdio and HTTP:
`initialize`, `tools/list`, and `tools/call` produce the same catalog and
tool-call behavior. The HTTP adapter owns streamable-HTTP session framing,
bearer auth, request limits, and client compatibility tests.

The local stdio bridge remains for desktop Mim. It still reads
`~/.mim/server.json` or `MIM_PORT`/`MIM_TOKEN`, connects to local WebSocket, and
binds as `actor: 'user'` under the existing loopback trust model.

### Reference Deployment

Deployment docs should lead with the adoption path this audience can actually
run: a private-overlay node on an always-on lab machine, Mac mini, workstation,
or small server. Tailscale/WireGuard plus loopback-bound `mim serve` avoids
public TLS, reverse-proxy, and fail2ban setup while still solving "agents keep
running when laptops close."

The public-host reference remains important for teams that have an operator:
a VPS or cloud box owned by one team. Mim does not terminate TLS; a reverse
proxy does:

```text
mim.example.com {
    reverse_proxy 127.0.0.1:4780
}
```

That is the minimal Caddy shape: Caddy obtains and renews Let's Encrypt
certificates automatically, `mim serve` keeps binding loopback, and only the
proxy faces the internet. Auth is bearer tokens over TLS — the
`Authorization: Bearer` pattern every MCP client, CI system, and `curl`
already speaks. Client certificates (mTLS) are stronger and operationally
expensive (per-member issuance, renewal, revocation); they are neither
required nor planned.

The three-line Caddyfile is a pitch, not the complete production recipe.
Deployment docs must include tested streaming proxy settings for MCP
streamable HTTP: no response buffering, idle/read/write timeouts long enough
for unattended runs, and clear keepalive behavior. Public exposure makes the
phase-one rate limits and body caps mandatory, and adds one deployment-doc
requirement: repeated auth failures from an address must be banned (fail2ban
or equivalent), because a public endpoint is scanned within hours of existing.

### Route and Auth Matrix

Serve mode must make the route contract explicit instead of inheriting local
desktop assumptions.

| Route | Desktop mode | Serve mode phase one |
|---|---|---|
| `/mcp` | Not required; local clients use `mim mcp` stdio | Public MCP streamable HTTP; bearer token required; dispatches as `actor: 'remote'` |
| `/ws` MCP identify | Local only; desktop-minted MCP token; dispatches as `actor: 'user'` | Disabled in serve mode |
| `/ws` package iframe identify | Local app iframe launch tokens | Disabled in serve mode; no query-string launch tokens over the network |
| `/api/ai/*` | Shell token from trusted renderer | Disabled in phase one. Phase four gets a new authenticated run API, not the shell-token route |
| `/workspace-files/*` | Local artifact viewers | Disabled in serve mode in phase one. Use `fs_read` over MCP instead |
| `/packages/:id/*` | Local app iframe UI files | Disabled in serve mode in phase one |
| `/sdk/*` | Local app iframe SDK assets | Disabled in serve mode in phase one |
| Health/status | Optional local diagnostic | May expose only process liveness without workspace paths, package lists, or tokens |

This matrix is a test contract. Any route not listed is denied by default in
serve mode.

Route gating is keyed on `ServerMode`, never on peer address. In the
reference deployment every request reaches Mim from loopback (the proxy
connects locally), so "loopback caller" proves nothing in serve mode, and
`X-Forwarded-*` headers are client-controlled and untrustworthy. If a
disabled route is ever needed for on-box diagnostics, that is an explicit
operator flag, not an address check.

### Identity

Phase-one identity is local and file-backed. `mim serve token create --name
anna` mints a bearer token once, prints it once, and stores only a SHA-256 hash.
The command prints ready-to-paste setup snippets for the common clients:
`claude mcp add`, a Codex config block, a Gemini config block, and a raw `curl`
example. The operator should be able to paste one Slack message and get a
teammate to first value in under two minutes.
Records live under operator-owned server state, not inside the workspace, for
example:

```text
~/.mim/serve/<workspace-id>/
  callers.json      # token hashes, names, status, grants, lastSeen
  policy.yaml       # optional operator-edited grant file
```

The token record has:

- `id`: stable non-secret identifier for audit and revocation.
- `name`: human-readable caller name, e.g. `anna` or `ci-pipeline`.
- `hash`: SHA-256 of the token, compared with constant-time equality.
- `grants`: allowed tools/effects/path scopes.
- `revokedAt`, `createdAt`, `lastSeenAt`.

Lost tokens are expected. Phase one must include a painless reissue path:
`mim serve token rotate <id>` revokes the old token, mints a replacement, and
prints the same client snippets in one operation.

Every authenticated request receives a `CallerIdentity`:

```ts
interface CallerIdentity {
  actor: 'remote'
  principal: string        // stable token id or mim-web principal
  callerName: string       // display label
  transport: 'mcp-http'
  sessionId?: string
}
```

`ToolContext` and trace events must grow explicit caller fields. Relying on
`ctx.agent` is not enough: today it is descriptive metadata, not the security
principal, and the registry does not stamp it onto trace events. `trace.query`
and `trace.stats` must be able to filter by caller principal/name.

At team scale, mim-web becomes the issuer and validator. That is phase three;
phase one must work without a web dependency.

### Remote Actor and Policy Gate

Remote calls never bind as `actor: 'user'`. `remote` is a first-class actor in
`ToolContext`, `TraceEvent`, and `PermissionDecisionEvent`.

Before any remote grants ship, the actor model gets an audit pass: public or
serve-mode transports may construct `actor: 'remote'` only. The existing local
desktop WebSocket MCP path may continue binding as `actor: 'user'` only in
desktop mode, under the discovery-token loopback trust model. No serve-mode
route may create `user`, `system`, or `package` context from request data.

For `remote`, the gate does not create approval requests. It resolves a caller
grant and decides synchronously:

1. No identity or no grant resolver: deny.
2. User-only tools deny (`app.trust`, `registry.trust`, interactive agent
   session control, renderer bridge tools, and any Electron-only tool).
3. Sensitive or outside-workspace paths deny for all effects. There is no
   remote prompt and no developer bypass.
4. Tool id must match an allowed exact id or namespace pattern.
5. Resolved effect must be allowed (`read`, `mutate`, `external`). The effect
   must use the gate's resolved static or dynamic tool policy, not only the
   current static `toolEffect(name)` helper.
6. If a grant declares path scopes and the tool has path-bearing params, every
   path must fall under an allowed scope.
7. The decision is recorded with caller identity, grant id, tool, effect, and
   target.

Example policy:

```yaml
callers:
  anna:
    allow: [read, external]
    tools: [issues.*, knowledge.*, search.files, trace.query]

  ci-pipeline:
    allow: [read, mutate]
    tools: [issues.create, log.append]
    paths: [reports/, outputs/]

  night-referee:
    allow: [read, mutate]
    tools: [fs.read, comments.*, issues.*]
    paths: [drafts/]
```

The same resolver should serve routines later: a routine identity is an
internal caller with a grant; a remote token is an external caller with a
grant.

### Executable and Prompt-Bearing Workspace Floor

The workspace is not passive data. Some paths are code, prompt, or control
surfaces that the kernel later executes or injects into model context. Remote
write grants cannot cover them, even when a grant otherwise allows broad
workspace mutation.

Serve mode adds a hard remote-write deny floor for:

- `AGENTS.md`, `CLAUDE.md`, and any future root instruction file.
- `mim.yaml` and workspace configuration that changes routing, sync, or shared
  workspace identity.
- `skills/**` and every `SKILL.md`, because skill text is prompt input.
- `routines/**`, because routine definitions start agent turns and carry
  approval grants.
- Workspace app/package directories and manifests, especially backend JS and
  contribution declarations.
- Tool policy, grant policy, token records, provider keys, account tokens, and
  operator serve-state files.

Denied means denied, not "needs approval": no remote caller can install or edit
code/prompt/control surfaces through `fs.write`, `fs.edit`, import tools, app
authoring tools, archive extraction, or any named app tool. App and skill
development against a shared workspace needs a separate operator/development
flow, not a remote mutation grant.

### Sharing a Workspace

Moving a workspace to a server is a one-time event, not an ongoing
relationship. "Share this workspace" has two payloads:

1. The file workspace: the workspace is (or becomes) a git repo, the server
   clones it, and from that moment the server copy is canonical. The laptop
   copy is demoted from "the workspace" to a replica of it, and `mim.yaml`
   records the shared-workspace pointer.
2. Selected structured app state: app data for server-owned namespaces such as
   Board issues, Knowledge entries, and References libraries is copied to the
   server at share time. Sessions and traces are not migrated by default:
   desktop history stays local, while work done on the server produces new
   sessions and traces on the server.

Server-owned named tool namespaces — `issues.*`, `knowledge.*`,
`references.*` — cut over at sharing time: once phase 2 routing is in place,
desktop sends those calls to the shared workspace, so that state has one
writable copy and is never a sync problem. Without the structured-state
migration step, existing users would share a mature workspace and arrive at an
empty board; that is not acceptable first-run behavior.

### Canonical State and Backups

Once shared, the server becomes canonical for more than git-tracked files:
issues, knowledge, references, sessions, traces, token records, grant policy,
and server secrets live in gitignored `.mim/` or operator-owned `~/.mim/serve/`
state. Phase one therefore needs a boring backup story.

Minimum requirement: `mim serve backup` (or an explicitly documented tar layout)
captures the workspace `.mim` state needed for structured data plus the
operator serve state outside the workspace. `mim serve restore` or a documented
restore procedure must be tested. Files still use git; structured state must
not be a single disk away from loss.

### Consumption Models

1. **Live remote source** (phase 1). Callers use the shared workspace's tools
   directly over MCP. This is the mode for issues, knowledge, references,
   logbook, search, trace queries, and any caller with no clone.
2. **Git-sync replica** (phase 2 ships the baseline). Researchers who want
   fast native editing, offline work, or local toolchains keep a clone.
   Phase 2 scope is remote named-tool routing over today's managed sync
   semantics — opt-in, explicit `sync.now`, stop on conflict (see
   [git.md](../git.md)) — with the shared workspace tending the git remote.
   The invisible-sync end state (pull on workspace open and window focus,
   commit and push on idle after saves, one status word — "Synced · just
   now" — and no git vocabulary anywhere in the UI) is a substantial
   subsystem and gets its own managed-replica-sync proposal (track E).
3. **Thin client** (track A). The default for non-technical users: open the
   shared workspace with zero local files. The editor streams file content
   over the authenticated API and saves write back; the terminal is a server
   pty. No clone, no sync, no conflicts — the Google Docs / VS Code Remote
   mental model.

These compose. Files flow through git or stream over the API. Shared
structured state flows through tools.

The conflict posture — charter for the track E proposal, not phase-2 scope —
attacks frequency before UX. Structured state only earns the "single writer"
label after two things exist: phase-one server-side serialization for app-data
writes, and phase-two routing that shadows local named tools for server-owned
namespaces. Git auto-merges non-overlapping prose edits silently, and different
files never conflict at all. Presence — the server knows who has a file open,
from thin clients directly and from replicas on sync — turns most of the
residue into a soft "Anna is editing this file" warning before a conflict
exists. The rare true conflict surfaces as a choice card ("Keep yours / Keep
Anna's / Compare", with Compare opening the existing diff review UI), backed
by `.mim/history` so the losing version is one click from recovery. Raw git
conflict markers in a user's file, or git vocabulary in sync UI copy, are
bugs. Continuous Dropbox-style bidirectional file sync is explicitly refused;
git is the only replication mechanism.

Phase one is honestly useful for MCP clients, automation, and read-mostly
access, but it does not fully enforce single-writer semantics for desktop
clones. That requires phase two: when a workspace declares server-owned tool
namespaces, desktop Mim shadows or disables matching local named tools and
routes those calls to the shared workspace. A local app may still exist for UI,
but the canonical `issues.*`, `knowledge.*`, and `references.*` tools must
come from the configured remote unless the user explicitly enters a development
mode.

### Desktop Mim as a Client

The desktop main process grows an MCP HTTP client that mounts configured
remote tools into the local registry under a source-qualified identity.
Configuration lives in `mim.yaml`; credentials live outside the workspace in
`~/.mim/keys.env` or a serve-token store.

The local gate still applies before anything leaves the machine. A remote
tool call is an external effect locally, then a `remote` actor call on the
shared workspace. The UI should show where a tool executes, but it should not
turn into an admin console. One Settings > Workspace section is enough.

Tool-execution chrome is a hard phase-two requirement: once desktop chat can
mount remote tools, every consequential action must make clear which workspace
will be read or mutated. The server also reports its Mim version and shared
workspace API/capability version during connection setup. Desktop warns on
unsupported or meaningfully skewed versions before mounting remote tools.

### Secrets on a Headless Server

Desktop integrations use keytar over the OS keychain. A headless Linux box may
not have a usable keychain, so serve mode needs a file-backed `SecretStore`
behind the same interface:

```text
~/.mim/serve/<workspace-id>/secrets.env
```

The file is mode 0600, re-chmoded on every write, and lives outside the
workspace. Server-state files (`callers.json`, `policy.yaml`, `secrets.env`)
join a serve-mode hard-deny path floor for every non-system actor, not merely
an approval prompt. `mim serve status` states plainly whether the runtime is
using OS keychain or file-backed secrets.

The security statement is deliberately honest: on a server, secrets-at-rest
protection is the host's disk encryption and Unix account isolation. AI keys
need no change; the resolver already prefers `~/.mim/keys.env` over env vars.

### What Phase-One Serve Mode Cannot Do

Phase one exposes the MCP tool surface only. Capabilities outside that surface
get one of two treatments:

- **Excluded from the catalog:** renderer bridge tools, native dialogs,
  pty/terminal, CLI agent sessions, app iframe views, live browser sessions.
- **Present but self-reporting only when useful:** `export.pdf` and
  `render.htmlToPdf` can report headless unavailability until a Playwright or
  Chromium sidecar is justified by real server use.

## Phases

### Phase 0 - serve-safe server core

Make the server module hostable outside Electron without changing desktop
behavior.

- Add `ServerMode = 'desktop' | 'serve'` options: bind host, port, public
  route matrix, and catalog mode. Route availability is decided by mode,
  never by peer address (see the route matrix note).
- Extract post-`openWorkspace` server composition from `index.ts` into shared
  boot code used by desktop and serve.
- Preserve local `mim mcp` and discovery-file behavior exactly.
- Make MCP catalog generation registration-aware: absent tools are omitted
  with startup diagnostics; missing `inputSchema` remains a hard error for
  tools that are actually exposed.
- Add trace/tool context fields for `remote` and caller identity, even before
  remote serving is enabled.
- Audit actor construction: public/serve transports can construct `remote`
  only; the desktop WebSocket MCP bridge remains the only `user`-binding
  network adapter and only in desktop mode.
- Add the serve-mode route/auth matrix tests.

Outcome: Electron behavior is unchanged, and a headless test can boot the
server in serve mode with all non-public routes denied.

### Phase 1 - authenticated shared workspace

The minimal useful increment: an authenticated MCP source on a tailnet or
behind a reverse proxy.

- `mim serve` command with explicit `--workspace`, optional `--host`/`--port`,
  and refusal to start without at least one issued token (any bind address).
- Local token commands: `mim serve token create/list/revoke`.
  `create` prints ready-to-paste Claude, Codex, Gemini, and `curl` snippets;
  `rotate` revokes and reissues in one operation.
- MCP streamable HTTP `/mcp` endpoint over the existing catalog: core allowlist
  + named app tools + conditional integration tools.
- First-class `remote` actor and declarative grant resolver.
- Serve-mode executable/prompt-bearing deny floor for root instructions,
  `mim.yaml`, skills, routines, workspace apps/packages, policy, token, and
  secrets files.
- Serve-mode SSRF defense for URL-reading and HTTP tools: deny localhost,
  link-local, private ranges, cloud metadata addresses, IPv6 local ranges,
  redirects into denied ranges, and DNS results that resolve to denied ranges.
- Per-token rate limits, body caps, and revocation closing active sessions.
- Cached policy/catalog reads appropriate for per-token rate limits, while
  still invalidating on settings, app reload, and grant changes.
- MCP `tools/list_changed` notification when named tools, integration tools,
  or policy exposure changes.
- Per-namespace or per-app-data-store write serialization for server-owned
  structured state so concurrent `issues.*`/`knowledge.*`/`references.*` calls
  cannot lose updates.
- Share-time structured-state migration for server-owned app namespaces.
- Backup and restore path for workspace `.mim` structured state plus
  operator-owned serve state.
- Denied-request ledger with actionable denial messages and enough metadata
  for an operator to turn a denial into a grant.
- Deployment docs for private-overlay first-run, public reverse-proxy
  streaming timeouts, auth-failure banning, and operator trace/state growth
  checks.
- Trace attribution by caller principal/name for every call and gate decision.

Outcome: Claude Code, Codex, Gemini CLI, CI, and `curl` can read/search and
write explicitly granted shared state, with every action attributed and
policy-checked.

### Phase 2 - desktop Mim as a client

- Shared-workspace configuration in `mim.yaml`; token outside the workspace.
- Remote tool mounting in the desktop registry with source-qualified identity.
- Server-owned namespaces route to the shared workspace and shadow local named
  tools to preserve single-writer semantics.
- Use today's managed sync semantics to tend the git remote: explicit
  `sync.now`, conservative git operations, and stop-on-conflict. Invisible
  background replica sync is track E, not phase 2.
- Minimal UI in Settings > Workspace, clear tool-execution chrome, and a
  server version/capability handshake with desktop warnings on unsupported or
  meaningfully skewed versions.
- Evaluate one conservative retry path for explicit sync
  (pull/rebase/push when the local worktree is clean) before surfacing a
  conflict; still stop rather than inventing silent conflict resolution.

Outcome: a teammate can ask local chat to file an issue, and the issue exists
in the shared workspace immediately.

### Phase 3 - mim-web issued identity

- mim-web grows caller management beside registry clients: mint, entitle,
  revoke, validate.
- Server validates tokens against mim-web with an operator-configured offline
  grace cache.
- The same principal can entitle private apps and name shared-workspace calls.
  This is also the identity substrate for a future managed hosted offering, so
  token validation and principal ids must not assume local-only administration.

Outcome: team infrastructure access has one administrative source, with
revocation that does not require redeploying the server.

### Phase 4 - unattended agent runs

- Add an authenticated run API for remote callers and routines. Do not reuse
  the desktop shell-token `/api/ai/chat` route.
- Propagate caller identity and grant context through `streamProfileResponse`,
  `createAiSdkTools`, skill/package preflight calls, nested tool calls, model
  trace events, and session persistence.
- Enforce caller grants for every tool the model calls, not just for the
  request that started the run.
- Attribute model usage and estimated cost to the initiating caller principal
  on every phase-four run. Spend ceilings can follow; attribution ships with
  the run API.
- Desktop History can list and open server-hosted unattended sessions
  read-only. "The run succeeded but nobody can find the chat" is a product
  failure, not an open question.
- Depend on [context-compaction.md](context-compaction.md) so long unattended
  runs survive context growth.

Outcome: a nightly referee or literature monitor runs on the shared workspace,
files comments/issues, and leaves a normal session and trace.

## Product Requirements

- **Time to first value.** Token creation prints exact client setup snippets.
  The operator should be able to send one message; the teammate pastes one
  command/config block and asks a question against team memory.
- **Opinionated consumption defaults.** Non-technical users should be steered
  toward thin clients when available; technical users toward git-sync replicas;
  agents, CI, and automation toward MCP. Users should not have to understand
  all three models before starting.
- **Actionable denials.** Remote denial messages say what to ask for, e.g.
  "ask your operator to grant `issues.create`." Denials also enter the
  operator ledger so failure becomes onboarding, not a dead end.
- **Remote run visibility.** Server-hosted agent sessions must be discoverable
  from the normal desktop History surface by phase four.
- **Demo story.** The flagship demo is a routine or Slack-triggered overnight
  referee/literature agent that runs on the shared workspace, files comments or
  issues, posts a Slack summary, and leaves an attributed session/trace.
- **Presence pays early.** Full thin-client presence is track A/E, but even
  early "active callers" and "last touched by" status in `mim serve status` or
  workspace views will make the workspace feel shared.

## Strategic Direction — Post-Phase-4 Sketches

Sketches, not commitments, and tracks, not phases: they are not strictly
ordered and none is implementation-ready. They exist so phases 0-4 don't
paint the road shut. Each needs its own proposal before implementation.

### Track A — thin-client workspace editing

The default consumption mode for non-technical users: open a shared workspace
with zero local files. An authenticated file read/write API for the editor
(the `/workspace-files` routes grow caller auth instead of staying disabled
in serve mode), per-file presence with soft-lock warnings, autosave writing
back to the server under the caller's grant. Presence is advisory and
activity-based, never a hard lock: it reflects recent edits with a heartbeat
and decays when idle, so an abandoned open tab never blocks a colleague;
correctness comes from stale-write hashes at save, not from the lock. Later refinement: lazy local
caching of recently opened files so reads survive a flaky connection.

### Track B — remote terminal and agent sessions

node-pty is plain Node, not Electron. A shared workspace can host ptys and
CLI agent sessions (Claude Code, Codex, Gemini CLI) server-side; shells
render the byte stream over the wire, exactly like SSH. This is "agents
outlive laptops" for interactive work. It supersedes the deferral below once
caller identity and grants are proven through phases 1-4, because a pty is
the caller's full Unix authority and must be gated accordingly.

### Track C — async review queue

Unattended runs inherit a desktop assumption that approval is synchronous.
Instead: runs execute to completion against a policy ceiling, mutations that
exceed the caller's standing grants are staged rather than applied, and a
human clears a review queue — diffs, outbound messages, created issues — from
any shell. Approval as pull request, not sudo prompt. This is the biggest
missing primitive for the agents-do-the-work future and deserves its own
proposal; it is noted here because phase 4 and tracks A-B create the demand.

### Track D — browser shell

Requires the north-star renderer migration (renderer speaks only the server
API) plus tracks A-C; at that point serving the Vue shell as a web app
against a shared workspace becomes a packaging decision, not an architecture
change.

### Track E — managed replica sync

The invisible-sync end state for replicas described under Consumption Models:
background pull/commit/push keyed to open, focus, and idle; one status word;
presence reporting; the conflict choice card backed by `.mim/history`; no git
vocabulary in UI copy. Today's managed sync (opt-in, explicit, stops on
conflict) is the phase-2 baseline it replaces.

## Security Considerations

- **No remote-as-user.** No network caller may ever bind as `actor: 'user'`.
  Serve boot must make constructing a public server without a remote policy
  resolver impossible. The local desktop WebSocket MCP bridge is the only
  network-shaped exception, and it is desktop-mode only.
- **Transport security is delegated.** Mim does not terminate TLS. Supported
  deployments are loopback, a reverse proxy terminating TLS (the reference
  deployment), or a WireGuard-class private overlay. `mim serve` warns on
  non-loopback public addresses.
- **Public route deny by default.** Phase one exposes `/mcp` only. Static file,
  app iframe, SDK, WebSocket package, and shell-token AI routes stay local-only
  or disabled.
- **Hash-only tokens.** Tokens are shown once, stored as hashes, compared in
  constant time, revocable by id, and never logged.
- **Sensitive floor is hard deny.** Sensitive paths, outside-workspace paths,
  and operator server-state files cannot be granted to remote callers.
- **Executable workspace floor is hard deny.** Root instructions, workspace
  config, skills, routines, workspace apps/packages, manifests, backend JS,
  policy, token, and secret files are code/prompt/control surfaces. Remote
  writes to them are denied regardless of grant.
- **Serve mode blocks SSRF targets.** URL-reading and outbound HTTP tools deny
  localhost, private ranges, link-local addresses, cloud metadata endpoints,
  IPv6 local ranges, redirects into denied ranges, and DNS answers resolving
  to denied ranges unless a future operator-only allowlist deliberately opens
  a narrower target.
- **Tool policy cannot be self-mutated.** Remote callers cannot change the MCP
  exposure policy, serve grant policy, token records, app trust, registry
  trust, account tokens, or provider keys.
- **Prompt injection remains a residual risk.** Policy ceilings prevent an
  injected instruction from exceeding the caller's grant; trace attribution
  makes actions reviewable. This mitigates but does not eliminate poisoned
  workspace context.
- **Resource abuse is part of v1.** Per-token request rate limits and request
  body caps ship in phase one. Per-token AI spend ceilings can follow once
  phase four exposes agent runs. Phase four still ships per-caller cost
  attribution immediately.
- **Canonical state needs backups.** Shared workspace structured state and
  operator serve state are part of the service boundary; phase one must have a
  tested backup/restore story before teams depend on it.
- **Blast radius is the Unix account.** The server should run as a dedicated
  account whose home holds only `~/.mim` server state and the workspace.
  Granting `shell.run` or `code.run` grants exactly that account's authority.

## Acceptance Tests

Phase one is not complete until these are automated:

- Serve mode refuses to boot with no issued tokens, at any bind address.
- Unauthenticated `/mcp` requests fail; authenticated requests succeed.
- `/workspace-files`, `/packages/:id`, `/sdk`, `/api/ai/*`, and package
  WebSocket identify are unavailable in serve mode even to loopback callers,
  since proxied traffic arrives from loopback.
- Serve-mode disabled routes stay disabled for requests from `127.0.0.1` even
  when `X-Forwarded-*` headers claim an external client or trusted proxy.
- Static MCP catalog omits unregistered Electron-only tools instead of
  throwing, while exposed tools without `inputSchema` fail startup.
- Public/serve transports construct `actor: 'remote'` only. No serve-mode
  request path can bind `user`, `system`, or `package` from request input.
- A read-only caller can `fs_read` allowed paths and cannot call mutating,
  external, sensitive-path, or ungranted tools.
- A mutate-granted caller can write only under granted path scopes.
- Even with broad mutate grants, remote writes to `AGENTS.md`, `CLAUDE.md`,
  `mim.yaml`, `skills/**`, `routines/**`, workspace app/package dirs,
  manifests, backend JS, grant/token/policy files, and secrets are denied.
- Serve-mode `web.read`, app HTTP, and other URL-fetching tools deny
  `localhost`, `127.0.0.0/8`, `::1`, RFC1918/private ranges, link-local
  ranges, `169.254.169.254`, IPv6 local ranges, DNS results in denied ranges,
  and redirects into denied ranges.
- `settings.set` cannot change tool policy over MCP; serve policy/token files
  cannot be read or written by any remote tool call.
- Every `tool.call`, `tool.result`/`tool.error`, and `gate.decision` event
  contains the remote caller principal/name.
- Revoking a token prevents new calls and closes active MCP sessions.
- `mim serve token create` prints ready-to-paste client snippets; token rotate
  revokes the old token and prints a replacement in one command.
- Denied remote calls write a denied-request ledger entry with caller, tool,
  effect, target, and suggested grant/action text.
- Concurrent writes to the same server-owned app-data namespace are serialized
  and cannot lose updates.
- Sharing an existing workspace migrates selected server-owned app data
  (issues/knowledge/references) while leaving sessions/traces local unless the
  user explicitly chooses otherwise.
- Backup and restore round-trip a shared workspace's structured `.mim` state
  plus operator serve state into a fresh server instance.
- MCP clients receive `tools/list_changed` when app reload, integration status,
  or policy changes alter the catalog.
- Phase-four model usage and cost events include the initiating caller
  principal. Desktop History can open server-hosted unattended sessions
  read-only.
- Existing desktop `mim mcp` tests continue to pass unchanged.

## Relationship to Sibling Proposals

- [routines.md](routines.md) - scheduled and triggered agent runs. A routine
  should consume the same declarative approval-policy resolver with an internal
  caller identity.
- [context-compaction.md](context-compaction.md) - long-run context compaction
  in the AI runtime. Required before unattended server-side agent runs.
- Async review queue - no proposal exists yet; the track C sketch above is
  its charter.
- Managed replica sync - no proposal exists yet; the track E sketch and the
  conflict-posture paragraph under Consumption Models are its charter.

## Explicitly Not Building

Permanent refusals:

- A separate server product or server-only data model.
- Multi-tenant SaaS. One process serves one workspace for one team that trusts
  one operator.
- TLS termination, SSO, or user directories inside mim-os. The reverse proxy
  and (later) mim-web own those.
- Real-time collaborative editing or CRDTs. Presence, soft locks, git merge,
  and the conflict choice card are the ceiling; concurrent character-level
  editing is not a goal.
- Continuous Dropbox-style bidirectional file sync. Git is the only
  replication mechanism.

Deferred, not refused (see Strategic Direction):

- A browser version of the Vue desktop shell (track D).
- Remote terminal/pty and CLI agent sessions (track B). SSH owns remote shell
  until then.
- App iframe hosting over the network (with or after track A).
- Invisible background replica sync (track E). Phase 2 uses today's explicit
  managed sync.

## Open Questions

- **MCP event push beyond catalog changes.** `tools/list_changed` is required
  in phase one. Is polling `issues.list`/`trace.query` enough for all other
  phase-one updates, or do remote clients need additional notifications?
- **Multiple workspaces per host.** One process per workspace is the base
  model. Is a thin `mim serve --all` supervisor useful, or is systemd/launchd
  sufficient?
- **Remote session interaction.** Phase four requires read-only desktop History
  visibility for server-hosted sessions. Should desktop Mim also continue those
  chats interactively, or is read-only inspection enough until thin-client work?
- **Grant granularity.** Tools x effects x paths is v1. Per-parameter
  constraints, such as `issues.update` but not `status: closed`, should wait
  for demonstrated need.
- **Offline mim-web validation.** How long may a server honor a mim-web token
  it cannot revalidate? The default must balance availability and revocation
  latency.
- **Presence transport.** Thin clients can report open files directly; how do
  replicas report theirs — on sync only, or via a lightweight presence ping?
- **Sharing an existing workspace with git history.** Structured app-state
  migration is required. Does "share this workspace" push full git history or
  start a fresh root commit? Large histories and accidentally-committed secrets
  argue for offering both.
