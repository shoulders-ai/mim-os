# Mim Serve

Status: superseded by [Mim Restructure](team-source.md). The implementation remains
in the repository pending a deliberate removal pass; the unfinished hardening
and product tracks below are no longer the product roadmap.

`mim serve` runs a headless Mim on a machine that stays awake - team infra, a
tailnet node, or a small cloud box - hosting team services continuously and
serving them to desktop Mims, CLI agents, and automations. It is not a
separate server product. It is the same kernel, the same tool registry, the
same permission gate, and the same trace stream, booted without Electron and
reachable over a controlled network.

The user-facing noun should move from **shared workspace** to **team space** or
**shared space**. "Workspace" already means "the folder I opened on my
computer"; reusing it for a remote service suggests folder sync and makes the
product model muddy. "Server" stays operator vocabulary for the CLI, process
model, and deployment docs. Existing code and config may keep
`sharedWorkspace` as an internal compatibility term, but the product should
teach people "connect this folder to a team space", not "turn this folder into
the server workspace."

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
  and works offline. A hosted team space is the same process on a machine that
  stays awake — not a different product.
- **Compute lives with the machine that owns the data.** Local files, local
  terminal ptys, and local code execution stay local. Team-space issues,
  knowledge, references, routines, traces, and server-hosted agent runs happen
  on the always-on host. There is no implicit attempt to make every client
  folder and the server folder identical.

Phases 0-4 below are deliberately incremental and are the committed plan.
The strategic-direction section sketches the rest of the road so near-term
decisions don't foreclose it.

## Current Status - 2026-07-14

This proposal is no longer a pure future plan. The repo now contains a large
part of the serve and shared-workspace plumbing, but the product is not ready
for ordinary installed-app users. The original product-model gap was that
invite redemption mutated the currently open folder. That gap is now corrected
at the plumbing level: connect is user-level, link is folder-level, and import
is still explicit future work.

Phase status:

- [x] Phase 0 core server safety is substantially implemented: serve mode,
  route restrictions, remote actor attribution, and serve-mode MCP HTTP tests
  exist.
- [x] Phase 1 runtime foundations are substantially implemented: serve token
  commands, authenticated `/mcp`, `/mcp/events`, remote grants, executable and
  sensitive deny floors, SSRF blocking, denied-request ledger, per-package app
  tool serialization, structured-state migration, backup/restore helpers, and
  caller attribution are present.
- [ ] Phase 1 operator readiness is not complete as a product experience:
  first-run hosting docs, private-overlay guidance, reverse-proxy streaming
  guidance, monitoring/rotation expectations, and "what should I send a
  teammate" need a pass.
- [x] Phase 2 connection/link infrastructure is substantially implemented:
  user-level connection storage under `~/.mim/`, local token storage,
  personal folder links under `.mim/`, compatibility reads for legacy
  `mim.yaml sharedWorkspace`, desktop/headless remote named-tool mounting,
  local named-tool shadowing for server-owned namespaces,
  version/capability warnings, and a status surface that distinguishes saved
  connections from linked folders exist.
- [ ] Phase 2 is not product-complete for desktop users: import/merge flows,
  broader source chrome, domain-by-domain link choices, stale/revoked
  connection handling, and the Phase 2.5 acceptance gate still need product
  hardening before ordinary installed-app users should be guided here.
- [x] Phase 2b invite connection plumbing is substantially implemented: invite
  mint/list/revoke, single-use `/join` exchange, `mim://`/paste handling,
  Settings connect card, user-level connection creation, explicit
  "Link this folder" action, local-only/connection-ready/connected status
  language, approval-card team-space chip, and live catalog refresh exist.
- [ ] Phase 3 mim-web identity is not implemented.
- [ ] Phase 4 unattended server-hosted agent runs are not implemented.

For a timestamped reconciliation of what is implemented in the current working
tree versus what remains open, see [mim-server-status.md](../mim-server-status.md).

User confusion report:

A user with Mim installed locally can open a folder on their desktop, but the
team-space story is opaque after that. They cannot tell whether they are
done, whether they need to host something, whether they need an invite, whether
files are local or remote, or why concepts like `mim serve`, MCP, tokens,
namespaces, and `mim.yaml` matter. This is a missing phase step. It must be
handled as product onboarding and role clarity before later phases add more
capability.

Second confusion report:

A user who already has local Board issues, Knowledge entries, References, and
ordinary project files may paste a join invite while an arbitrary folder is
open. If Mim writes a remote connection into that folder and silently routes
`issues.*`/`knowledge.*` somewhere else, the user cannot predict what happens
to existing local state. If Mim then suggests sharing or syncing files, the
blast radius is worse: multiple people with established local folders will
create duplicates, stale copies, and accidental uploads. The correct product
stance is: **joining a team space connects Mim to shared services; it does not
sync, upload, migrate, or take over the current folder unless the user
explicitly chooses that action after seeing an inventory and consequences.**

## Principles

- **One kernel.** `mim serve` = `createHeadlessKernel()` + `createServer()` with
  serve-mode options. No forked codebase, no parallel tool implementations, no
  server-only data model. The server's only special privilege is uptime.
- **Desktop compatibility is non-negotiable.** Existing desktop boot, local
  WebSocket app runtime, `mim mcp`, `~/.mim/server.json`, `MIM_PORT`, and
  `MIM_TOKEN` keep their current behavior unless the user explicitly connects
  to a team space or links a folder to one.
- **Policy replaces presence.** The desktop approval gate assumes a human at
  the screen. A team space has no screen, so approval becomes a
  declarative per-caller policy of allowed tools, effects, and path scopes.
  There is no serve-mode "allow everything" switch.
- **Attribution before capability.** Every remote call carries an issued caller
  identity, and every trace event produced by that call carries the same
  identity. A team cannot share a workspace it cannot audit.
- **Folders and team spaces are different product objects.** A local workspace
  is the folder the user opened. A team space is a remote service with its own
  canonical team state. A connection lets a local Mim use selected team
  services from selected local folders; it does not convert the folder into a
  replica, and it does not sync files by default.
- **Connect, do not sync.** Joining a team space must be safe even when the
  current local folder is unrelated. No files, issues, knowledge entries,
  references, sessions, traces, or app state move during join. Moving or
  merging data is a separate import/share flow with preview and confirmation.
- **No silent shadowing.** The product may offer a default target such as
  "Use team Board for this folder", but a local Board and a team Board cannot
  silently swap under the same UI. Consequential actions need a visible target:
  local folder or named team space.
- **MCP is the front door.** The public surface is MCP over streamable HTTP.
  Desktop-only WebSocket routes remain for local app iframes and the local MCP
  stdio bridge; they are not the public remote API in phase one.

## Product Model Reset

This proposal previously blurred three things that must be distinct:

1. **Local folder** — the directory a user opens in desktop Mim. It may already
   contain local files, local Board issues in `issues/`, local Knowledge
   entries in `knowledge/`, a local References library under `references/`,
   app enablement, sessions, traces, and personal workflow assumptions.
2. **Team space** — an always-on Mim service owned by a team. It has its own
   canonical team Board, team Knowledge, team References, routines,
   unattended agent runs, audit traces, caller grants, and backups. It may
   also have a server-side file workspace, but that file tree is not assumed
   to be a mirror of any client's open folder.
3. **Folder link** — an explicit relationship saying "when I work in this
   local folder, use this team space for these domains." Links can be created,
   removed, and changed without moving files. A user may link multiple local
   folders to one team space, link one folder to different spaces for
   different domains in a future version, or join a team space without linking
   the current folder at all.

The implementation can still use `mim serve --workspace /srv/team-space` and
internal `sharedWorkspace` config names. The product must not expose this as
"your folder became the server workspace." The user story is "you connected to
the team's shared memory and work queue."

### What Join Means

Accepting a team-space invite does exactly three things:

- Stores a user-level connection record and token outside any project folder.
- Shows the team space in Mim as an available shared service.
- Offers to link the currently open folder to that team space for selected
  domains, with an explicit confirmation.

Join does not:

- Upload or download files.
- Migrate local issues, knowledge, references, sessions, traces, app data, or
  app enablement.
- Edit the local folder's `mim.yaml` unless the user explicitly chooses "use
  this team space from this folder."
- Shadow local tools without a visible "Team" target.
- Make a promise of offline sync or conflict resolution.

If no folder is open, joining still succeeds. The team space appears in a
Spaces/Home surface, and the next local folder can be linked later. This
avoids the current accidental coupling to whatever folder happened to be open
when the user clicked the invite.

### What Happens to Existing Local Issues and Knowledge

Existing local Board and Knowledge records remain local. They are not deleted,
moved, synced, or hidden by joining. The product must support three explicit
states:

- **Local only** — this folder's Board/Knowledge/References continue to read
  and write local files (`issues/`, `knowledge/`, `references/`) exactly as
  before.
- **Team linked** — this folder uses a named team space for selected domains.
  UI labels say "Team Board" or "Team Knowledge"; actions write to the team
  space.
- **Mixed during migration** — both local and team data are visible during an
  import/merge flow, with clear source labels and no ambiguous writes.

Moving existing local state to a team space is an import operation, not a join
side effect. The import flow must:

- Detect local `issues/`, `knowledge/`, `references/`, and relevant app-data
  stores.
- Show counts, sample records, and destination team space before any write.
- Offer copy-by-default, not destructive move.
- Preserve ids where possible and show collisions before writing.
- Deduplicate by stable ids first, then by title/DOI/key heuristics where
  available.
- Produce an import report with created, skipped, merged, and conflicted
  records.
- Leave the local records intact until the user explicitly archives or removes
  them.

This import can be implemented with existing tools, but the user-facing flow
is mandatory. A CLI-only `mim serve state migrate` is an operator tool, not a
sufficient product answer for people who installed the app.

### What Happens to Files

Files do not sync by default. A local chat may read a local manuscript and
create a team issue about it, but that is a cross-source action:

```text
Read local file: ./draft.md
Create team issue in: HTA Model
```

The UI must show both sides before or during execution. Uploading a file,
copying a folder to the server, linking a git remote, or opening a thin remote
file view are separate actions with separate confirmations.

For the product, there are only three valid file modes:

- **Local files** — normal desktop Mim. Files stay on the user's machine.
- **Git replica** — an explicit clone/managed-sync relationship, for users who
  understand or choose repository-backed collaboration. No Dropbox-style sync.
- **Thin remote files** — future track A. No local clone; file reads/writes go
  directly to the team-space host with presence and stale-write checks.

There is no mode where Mim tries to sync every client's arbitrary open folder
to the server.

### Job Stories

- **Solo user:** When I install Mim and open a folder, I want to work locally
  without being told I have unfinished server setup, so I can ignore team
  spaces completely.
- **Teammate joining team memory:** When someone sends me an invite, I want to
  connect to the team's Board/Knowledge/References without risking my local
  files or local notes, so I can ask questions and file team issues safely.
- **Existing local project becoming shared:** When my mature Mim folder has
  issues and knowledge already, I want a reviewed import to a team space, so
  the team does not start with an empty board and I do not lose local data.
- **Researcher with many projects:** When I switch folders, I want Mim to show
  which team space, if any, this folder is linked to, so I do not write the
  wrong issue into the wrong team.
- **Operator:** When I host a team space, I want to invite people, see active
  callers, review denials, backup state, and rotate/revoke access without
  editing YAML over SSH for normal operations.
- **Automation/CI:** When a pipeline or script calls Mim, it should use a
  named token with narrow grants and no desktop folder assumptions.
- **Unattended agent:** When an overnight routine runs, it should use team
  memory and leave traceable outputs in the team space, not in someone's
  laptop-local folder.

### Product Risks This Reset Must Prevent

- A user joins while the wrong folder is open and accidentally links unrelated
  work to the team.
- A local Board appears to go empty because remote tools silently shadowed
  local tools.
- Two people each import the same local issues and create duplicate team
  records.
- A user assumes files synced because team issues are connected.
- A remote agent cannot see a local file, but the UI gave the impression that
  it could.
- A team host looks like a random folder with three installed app packages
  instead of a durable team service with backups, audit, identity, routines,
  and clear data ownership.
- Revoking a token leaves a stale folder config that looks connected but does
  nothing useful.
- A pre-existing hand-authored `mim.yaml sharedWorkspace` block (the legacy
  compatibility path) silently shadows a domain's local tools with no chip,
  warning, or link-step confirmation, because the new connect/link UI and its
  chrome only engage for connections created through the invite flow. A
  workspace already `configured` via the legacy block never routes through
  "Link this folder" at all. Phase 2/2.5 needs a migration or detection path
  for legacy configs, not just chrome for newly-created connections.

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
tooling is increasingly agents. Today each Mim is an island. Local folders
stay on laptops; team memory is copied by hand or by git discipline; agents
die when the lid closes.

An always-on team space gives the team:

- **Shared team memory.** Team Knowledge and team Issues have one authoritative
  copy that every connected Mim and automation can call.
  A teammate's CLI agent asks `knowledge_search` and gets the same answer the
  PI's desktop Mim gets.
- **A single writer for selected team domains.** Issues, Knowledge, and
  References become team-space services when a folder is linked to them. Local
  copies can still exist, but team-domain writes go to one host and one queue
  after the user chooses that relationship.
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
server module in serve mode. One process hosts one team-space storage root; a
team with three team spaces runs three processes. That keeps the trust boundary,
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
development against a team-space storage root needs a separate
operator/development flow, not a remote mutation grant.

### Creating, Connecting, Linking, and Importing

The previous "share this workspace" model was too coarse. It collapsed four
different user actions into one dangerous action. The product must keep them
separate.

1. **Create or host a team space.** An operator chooses or creates the
   server-side workspace folder that backs the team space. That folder is the
   service's storage root, not a promise that every teammate has a matching
   local clone. The operator enables team apps, configures backups, grants,
   and invitations.
2. **Connect Mim to a team space.** A human accepts an invite. Mim stores a
   user-level connection and token. No project folder changes yet.
3. **Link a local folder to a team space.** The user chooses "Use HTA Model
   team space from this folder" and selects domains: Board, Knowledge,
   References, routines, or future remote files. This writes folder-level
   config only after explicit confirmation.
4. **Import local state to the team space.** If the local folder already has
   issues, knowledge, or references, Mim offers an inventory and import/merge
   flow. Import is copy-by-default and produces a report. It is never implied
   by connect or link.

This separation answers the core safety question:

- **Connect** means "I can see/use the team service."
- **Link** means "in this folder, these domains should target that service."
- **Import** means "copy selected local records into the service."
- **Sync/replica** means "coordinate files through git" and is a separate,
  explicit relationship.

Team-owned named tool namespaces — `issues.*`, `knowledge.*`, `references.*`
— may become the default target for a linked folder, but only with visible
source labels and an easy way to inspect local data. A local app may still
exist for local-only work. The product must never make a mature local Board
look empty merely because a remote Board was mounted.

The server-side team space can be created in three ways:

- **Empty team space.** Start with no team records. Useful for greenfield
  projects, CI filing, or a demo.
- **Imported from a local Mim folder.** The operator or owner previews local
  issues, knowledge, and references, copies them to the team space, then
  links that folder to the imported domains.
- **Git-backed project replica.** The server clones a repo for teams that
  deliberately want server-side files. This is not automatic and does not
  make other clients sync every open folder.

### Canonical State and Backups

Once a domain is linked to a team space, the server becomes canonical for that
domain's team copy: team issues, team knowledge, team references, routines,
server-hosted sessions, traces, token records, grant policy, and server secrets
live in the team-space storage root or operator-owned `~/.mim/serve/` state.
Local copies are not automatically deleted or synced. Phase one therefore
needs a boring backup story for the team-space state people deliberately put
there.

Minimum requirement: `mim serve backup` (or an explicitly documented tar
layout) captures the team-space structured state plus the operator serve state
outside the storage root. `mim serve restore` or a documented restore
procedure must be tested. Git-tracked project files still use git when a team
chooses a git-backed replica; team structured state must not be a single disk
away from loss.

### Consumption Models

1. **Team service source** (phase 1). Callers use the team space's tools
   directly over MCP. This is the mode for team issues, team knowledge, team
   references, logbook, trace queries, CI, automation, and anyone with no
   local folder linked.
2. **Linked local folder** (phase 2 revised). A desktop Mim has a local folder
   open and a user-level team-space connection available. The user explicitly
   links selected domains in that folder to the team space. Local files remain
   local. Local app data remains local unless imported.
3. **Git replica** (track E baseline, not automatic join behavior).
   Researchers who want fast native editing, offline work, or local toolchains
   may keep a clone and use explicit managed sync. The invisible-sync end
   state (pull on workspace open and window focus, commit and push on idle
   after saves, one status word — "Synced · just now" — and no git vocabulary
   anywhere in the UI) is a substantial subsystem and gets its own
   managed-replica-sync proposal.
4. **Thin client** (track A). The default future mode for non-technical users
   who want to work directly in the team space with zero local files. The
   editor streams file content over the authenticated API and saves writes
   back; the terminal is a server pty. No clone, no sync, no conflicts — the
   Google Docs / VS Code Remote mental model.

These compose only when the user chooses them. Files flow through git or
stream over the API. Team structured state flows through team tools. Joining a
team space by itself chooses neither file mode.

The conflict posture — charter for the track E proposal, not phase-2 scope —
attacks frequency before UX. Team structured state only earns the "single
writer" label after server-side serialization exists and linked folders route
team-domain writes to the team target with visible source labels. Git
auto-merges non-overlapping prose edits silently, and different files never
conflict at all. Presence — the server knows who has a file open, from thin
clients directly and from replicas on sync — turns most of the residue into a
soft "Anna is editing this file" warning before a conflict exists. The rare
true conflict surfaces as a choice card ("Keep yours / Keep Anna's / Compare",
with Compare opening the existing diff review UI), backed by `.mim/history` so
the losing version is one click from recovery. Raw git conflict markers in a
user's file, or git vocabulary in sync UI copy, are bugs. Continuous
Dropbox-style bidirectional file sync is explicitly refused; git is the only
replication mechanism.

Phase one is honestly useful for MCP clients, automation, and read-mostly
access, but it does not solve desktop product semantics. That requires the
revised phase two: user-level team-space connections, explicit folder links,
import/merge, and visible source selection. A local app may still exist for
local work; a team app may exist for team work. The user must never have to
infer which one a tool name currently means.

### Desktop Mim as a Client

The desktop main process grows an MCP HTTP client that can connect to team
spaces and mount remote tools under a source-qualified identity. The
connection record is user-level and lives outside project folders. Credentials
live outside every workspace in `~/.mim/keys.env` or a serve-token store.

Folder-level configuration is a link, not the connection itself. A local
folder records "use team space X for domains Y" only after the user chooses
that relationship. Hand-edited `mim.yaml` may remain a compatibility path, but
the primary product path must not require or silently write folder config at
invite redemption time.

The local gate still applies before anything leaves the machine. A remote
tool call is an external effect locally, then a `remote` actor call on the
team space. The UI should show where a tool executes, but it should not turn
into an admin console. One Spaces/Workspace settings surface is enough if it
answers four questions plainly: Am I local only? Which team spaces am I
connected to? Is this folder linked to one? Which domains target local versus
team?

Tool-execution chrome is a hard phase-two requirement: once desktop chat can
mount remote tools, every consequential action must make clear which workspace
will be read or mutated. In cross-source actions, show both sides: local file
source and team-space destination. The server also reports its Mim version and
team-space API/capability version during connection setup. Desktop warns on
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

### Phase 1 - authenticated team space

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
- Operator/state migration tools for existing server-owned app namespaces.
- Backup and restore path for team-space structured state plus
  operator-owned serve state.
- Denied-request ledger with actionable denial messages and enough metadata
  for an operator to turn a denial into a grant.
- Deployment docs for private-overlay first-run, public reverse-proxy
  streaming timeouts, auth-failure banning, and operator trace/state growth
  checks.
- Trace attribution by caller principal/name for every call and gate decision.

Outcome: Claude Code, Codex, Gemini CLI, CI, and `curl` can read/search and
write explicitly granted team state, with every action attributed and
policy-checked.

### Phase 2 - team-space connection model

Do not ship remote desktop mounting as "write `sharedWorkspace` into the
currently open folder." Phase 2's first deliverable is the product-safe
connection model.

- Add a user-level team-space connection store outside workspaces. It contains
  display name, host, capability version, connection id, and token reference.
  It does not live in a random project folder.
- Add a folder-level link model: this folder may use connection X for domains
  Y. The link is explicit, reversible, and inspectable. Compatibility with
  `mim.yaml sharedWorkspace` can remain, but the UI flow must distinguish
  connection from folder link.
- Remote tools mount with source-qualified identity, but are not silently
  substituted for local tools. The registry can expose both local and team
  targets to the UI/agent planner, or expose a selected default only after the
  folder link says that domain targets the team space.
- Tool-execution chrome is a hard requirement: chat tool rows, approval cards,
  app work views, and status chips must show Local vs Team target before or
  during consequential actions.
- Cross-source actions must show both source and destination, e.g. "read local
  `draft.md`; create team issue in HTA Model."
- Server version/capability handshake warns before mounting tools when the
  client/server contract is unsupported or meaningfully skewed.
- Today's explicit managed sync remains separate. No file sync is started by
  joining or linking a team space.

Outcome: a desktop Mim can be connected to team services without changing any
local folder until the user explicitly links that folder.

### Phase 2b - invite-led connection

Phase 2b remains the human onboarding path, but its semantics change: the
invite creates a connection, not a folder mutation.

**The invite is the entire connection surface.**

- `mim serve invite create --name anna [--expires 7d]` mints a single-use
  invite in two equivalent forms: a paste string (`mim-invite-…`) and a
  `mim://join/…` deep link. Both encode the server URL, team-space id and
  display name, caller name, and a one-time redemption secret. `mim serve
  invite list/revoke` mirror the token commands; invite secrets are
  hash-stored beside `callers.json`.
- Redemption is an exchange. The client presents the invite once at a
  redemption endpoint and receives the durable bearer token, which lands
  directly in user-level token storage. The durable token never transits
  Slack, is never rendered in UI, and the invite dies on first use or expiry.
- The operator sends one link. CLI agents and automation still use phase-one
  token snippets.

**Join is not link.**

- Clicking or pasting an invite opens a confirmation card with one plain
  sentence: "This connects Mim to HTA Model. It will not upload, download, or
  change files in the folder you currently have open."
- Primary action: Connect. Secondary action, shown only after connection
  succeeds and only if a folder is open: Link this folder...
- The link step lists domains available from the team space: Board,
  Knowledge, References, routines, future remote files. The user chooses which
  domains, if any, this folder should use.
- If local records exist in a chosen domain, the link step does not hide them.
  It offers: keep local only, use team empty/current state, or import local
  records to team space first.
- Joining takes effect live for the connection list and catalog cache, but
  domain tools become defaults for a folder only after the folder link exists.
- Failure states are specific and actionable: invite already used/expired
  (request a new invite), host unreachable (retry), version skew (update
  client/server), grant denied (ask operator for the named grant).

**Scope chrome: local is unmarked only when there is no ambiguity.**

- A solo local folder with no team links stays visually quiet.
- Once a folder is linked, every team-backed surface carries the team-space
  chip. Local surfaces remain local-labeled when a same-domain team surface is
  also available.
- Board/Knowledge/References views need target selectors or separate source
  labels when both local and team records exist. A remote target cannot make a
  local board look empty.

Acceptance:

- Invite-to-connected in under one minute, without the user encountering MCP,
  bearer, token, YAML, or namespace vocabulary.
- Connection succeeds even when no folder is open.
- Connection does not modify the current folder until the user explicitly
  links it.
- Linking a folder shows available domains and detects existing local
  issues/knowledge/references before setting a team default.
- Every remote-routed tool call shows the team-space chip before and during
  execution, including approval prompts.
- Catalogs update live on `tools/list_changed`.
- The redemption endpoint remains the only tokenless route, exchanges each
  invite at most once, and rate-limits.

Outcome: the operator sends one link; the teammate connects to team memory
without risking local state, then deliberately chooses whether the current
folder should use that team space.

### Phase 2c - local state inventory and import

This phase is required before telling existing users to move real projects
onto a team space.

- Inventory local issues, knowledge entries, references, and relevant app-data
  stores for the open folder.
- Show counts, representative records, local paths, and destination team space.
- Provide copy-only import first. Destructive move/archive is a later explicit
  cleanup action.
- Detect collisions by id/path/key, then likely duplicates by title/DOI where
  possible. The user chooses skip, keep both, or merge for conflicts.
- Import through the same team tools remote callers use, so grants,
  serialization, trace attribution, and validation are exercised.
- Produce a durable import report stored locally and in the team trace.
- After import, offer to link the folder domains to the team copies. Do not
  assume import means link, and do not assume link means import.

Outcome: a mature local Mim project can become a team-backed project without
an empty-board surprise, silent duplication, or local data loss.

### Phase 2.5 - installed-app onboarding and role clarity

This phase is a product acceptance gate inserted because technical mounting
does not answer the installed user's basic question: "I opened a folder in
Mim; what now?" No later phase may rely on protocol vocabulary as the way to
discover the model.

Requirements:

- The local-only path is first-class. Opening a folder is enough; team setup
  is optional.
- The join path is invite-led and creates a team-space connection, not an
  implicit folder sync or folder mutation.
- The link path is explicit. A user can connect to a team space and decide
  later which local folders use it.
- The import path is explicit. Existing local issues, knowledge entries, and
  references remain local until copied or merged through a reviewed flow.
- The host path is clearly separate. Running `mim serve`, app installation,
  backups, revocation, and deployment are operator responsibilities, not the
  default next step for everyone who installed Mim.
- Status language is concrete: local only, connected to a named team space,
  folder linked to a named team space, import available, remote unavailable,
  or permission denied with a clear next action.
- The user can see when a tool action affects local state, team state, or both.
- First-run and sharing copy give opinionated defaults by role: solo user,
  teammate joining, existing-project owner importing, operator hosting, and
  automation/CLI caller.

Outcome: a person who installed Mim and opened a folder can tell within one
minute whether they are done, should paste an invite, should link this folder,
should import existing local state, or should hand hosting instructions to an
operator.

### Phase 3 - mim-web issued identity

- mim-web grows caller management beside registry clients: mint, entitle,
  revoke, validate.
- Server validates tokens against mim-web with an operator-configured offline
  grace cache.
- The same principal can entitle private apps and name team-space calls.
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

Outcome: a nightly referee or literature monitor runs on the team space,
files comments/issues, and leaves a normal session and trace.

## Product Requirements

- **Installed-app clarity.** The default desktop experience is local-first:
  install Mim, open a folder, and work. Team-space concepts appear only when
  the user chooses to join or host one.
- **No accidental folder binding.** Accepting an invite creates a user-level
  team-space connection. It does not edit the current folder, link domains, or
  sync files.
- **Explicit domain linking.** A local folder can use team Board, Knowledge,
  References, routines, or future remote files only after the user chooses
  those domains for that folder.
- **Local data stays local until imported.** Existing `issues/`, `knowledge/`,
  `references/`, app data, sessions, and traces are untouched by connection
  and linking. Import/merge is a reviewed copy operation with a report.
- **No silent source swap.** If local and team versions of a domain are both
  possible, the UI shows the target. A local Board cannot disappear because a
  team Board mounted.
- **Time to first value.** Human invites are one link; automation tokens print
  exact client setup snippets. The operator should be able to send one message
  and get a teammate connected to team memory without exposing protocol
  details.
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
  referee/literature agent that runs on the team space, files comments or
  issues, posts a Slack summary, and leaves an attributed session/trace.
- **Presence pays early.** Full thin-client presence is track A/E, but even
  early "active callers" and "last touched by" status in `mim serve status` or
  workspace views will make the workspace feel shared.

## Strategic Direction — Post-Phase-4 Sketches

Sketches, not commitments, and tracks, not phases: they are not strictly
ordered and none is implementation-ready. They exist so phases 0-4 don't
paint the road shut. Each needs its own proposal before implementation.
Tracks A-D are now chartered in [web-shell.md](web-shell.md); track E still
needs its own proposal.

### Track A — thin-client workspace editing

The default consumption mode for non-technical users: open a team space
with zero local files. An authenticated file read/write API for the editor
(the `/workspace-files` routes grow caller auth instead of staying disabled
in serve mode), per-file presence with soft-lock warnings, autosave writing
back to the server under the caller's grant. Presence is advisory and
activity-based, never a hard lock: it reflects recent edits with a heartbeat
and decays when idle, so an abandoned open tab never blocks a colleague;
correctness comes from stale-write hashes at save, not from the lock. Later refinement: lazy local
caching of recently opened files so reads survive a flaky connection.

### Track B — remote terminal and agent sessions

node-pty is plain Node, not Electron. A team space can host ptys and
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
against a team space becomes a packaging decision, not an architecture
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
- **Canonical state needs backups.** Team-space structured state and operator
  serve state are part of the service boundary; phase one must have a tested
  backup/restore story before teams depend on it.
- **No implicit data movement.** Connecting to a team space is not consent to
  upload local files or local app state. Import, upload, git replica, and thin
  remote file editing are separate flows with explicit target/source labels.
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
- Invite redemption creates a user-level team-space connection and stores the
  token outside workspaces; it does not edit the currently open folder's
  `mim.yaml` or any project file.
- Joining with no folder open succeeds and leaves a usable team-space
  connection for later folder linking.
- Linking a folder to a team space is a separate action with explicit selected
  domains.
- If a folder contains local `issues/`, `knowledge/`, or `references/`, the
  link flow detects them and offers local-only, team target, or import before
  any domain default changes.
- Importing existing local state to a team space copies selected
  issues/knowledge/references with collision reporting while leaving sessions,
  traces, and the local source records untouched unless the user explicitly
  chooses cleanup.
- Backup and restore round-trip a team space's structured state plus operator
  serve state into a fresh server instance.
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
- [web-shell.md](web-shell.md) - charters tracks A-D and the north-star
  renderer migration: the member-facing Shell API, browser shell, thin file
  editing, remote chat, review queue, and gated remote terminal.
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

## Decisions Landed

- **Connection store.** User-level team-space connections live under
  `~/.mim/shared-workspaces.json`. Bearer tokens remain in `~/.mim/keys.env`.
  Joining a team space never writes to the currently open folder.
- **Folder link file.** Folder links are personal by default and live under
  `.mim/shared-workspace.json`, which is already covered by the workspace's
  gitignored `.mim/` boundary. Existing `mim.yaml sharedWorkspace` entries are
  still read as a compatibility path, but new invite joins do not write them.

## Open Questions

- **Product noun.** Use "team space", "shared space", or another term? The
  important constraint is that user-facing copy must not imply that the
  current local folder is synced or converted by joining.
- **Local plus team UI.** Should Board/Knowledge show one target selector, two
  separate views, or a combined source-labeled view during migration? The
  answer should be tested with users who already have local issues/KG entries.
- **Import collision policy.** Which conflicts are auto-skippable, which are
  auto-mergeable, and which need human review? Issues can key by id/title;
  Knowledge by id/title/type; References by citation key, DOI, and title.
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
