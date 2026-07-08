# Mim Serve

`mim serve` hosts one workspace from a headless Node process over authenticated
MCP HTTP. It is the shared-workspace entrypoint for a VPS, lab machine, or other
always-on host.

## Quick Start

```bash
# On the server workspace
mim serve invite create --name anna --url https://mim.example.com/mcp --json
mim serve --host 0.0.0.0 --port 4780
```

Invite creation prints a `mim://join/...` deep link plus an equivalent
`mim-invite-...` paste string. Human desktop users join from that one artifact;
Mim redeems it once, stores the durable token locally, writes the
`sharedWorkspace` config, and never shows the durable token in the UI.

CLI agents and automation still use raw caller tokens. Token creation prints
ready-to-paste Claude, Codex, Gemini, and `curl` snippets. Tokens are shown
once; rotate a lost token instead of trying to recover it.

```bash
mim serve invite list --json
mim serve invite revoke invite_...
mim serve token list --json
mim serve token rotate caller_... --json
mim serve token revoke caller_...
```

## Desktop And Headless Clients

A local desktop user normally joins from an invite in Settings > Workspace.
The invite writes the same committed `sharedWorkspace` block that advanced
users may edit by hand:

```yaml
sharedWorkspace:
  id: team-server
  name: HTA Model
  url: https://mim.example.com/mcp
  namespaces:
    - issues.*
    - knowledge.*
    - references.*
```

The bearer token stays outside the workspace in `~/.mim/keys.env` under a
deterministic key derived from the id, for example:

```bash
printf '%s\n' 'tok_...' | mim shared-workspace token set team-server --stdin
mim shared-workspace token status team-server --json
mim shared-workspace token clear team-server
```

```env
MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=tok_...
```

On workspace open, the kernel initializes the remote MCP endpoint, warns when
the server version/capability handshake looks incompatible, and mounts matching
remote named tools into the local registry. Calls to those mounted tools pass
through the local gate as a network effect, then execute on the shared
workspace as the serve-mode `remote` actor. Mounted names are also included in
the local MCP dynamic catalog and refresh live when the server emits
`notifications/tools/list_changed`. Settings > Workspace uses plain status:
local only, connected, invite needed, or an error. It shows the shared
workspace name, host, and shared tool groups; it never shows bearer token
values or token storage keys.

Server-owned namespaces shadow local app-provided named tools so structured
state has one writer. Core tools are not shadowed: a `sharedWorkspace`
namespace such as `fs.*` is ignored when it collides with a local core tool.
If the token is missing or the remote sync fails, Mim logs a warning and leaves
the local tool surface intact.

## MCP HTTP

Serve mode exposes:

- `POST /join` — tokenless, rate-limited single-use invite redemption. Returns
  the durable caller token only to the joining Mim process.
- `POST /mcp` — JSON-RPC MCP requests authenticated with
  `Authorization: Bearer <token>`.
- `GET /mcp/events` — authenticated SSE stream for MCP notifications. Package
  reloads and named-tool changes emit `notifications/tools/list_changed`.

Desktop-only routes are disabled in serve mode: WebSocket `/ws`, `/api/ai/*`,
`/workspace-files/*`, `/packages/*`, and `/sdk/*`. Remote HTTP MCP calls enter
the tool registry as `actor: "remote"` with `principal`, `callerName`, and
`transport: "mcp-http"` attribution.

## Grants And Denials

Issued callers start with a read-only workspace grant for orientation, file
reads, file search, skill reads, log reads, and trace queries. The serve grant
resolver enforces effect, tool, and path scopes. Remote calls never use the
interactive approval queue.

Invite-created human callers keep those orientation grants and also receive
read/write grants for the shared tool namespaces advertised by the invite, such
as `issues.*`, `knowledge.*`, and `references.*`. The shared workspace config
and the caller grant are therefore aligned: if Settings says a namespace is
shared, the remote caller can actually use it unless a hard deny floor applies.

Remote writes to executable or prompt-bearing workspace surfaces are hard-denied
even if a grant accidentally includes them. The floor covers `AGENTS.md`,
`CLAUDE.md`, `mim.yaml`, `skills/`, `routines/`, workspace package directories,
and higher-level app/skill/routine/package management tools.

Denied remote requests are appended to the serve denial ledger:

```bash
mim serve denials list --json
```

The normal trace stream also records `gate.decision` events with caller
attribution.

## State Migration

Git moves workspace files, but Board, Knowledge, and References structured state
live in gitignored app data. After cloning or pushing files to a server, migrate
selected app data from the existing workspace:

```bash
mim serve state migrate --from /path/to/old/workspace --json
mim serve state migrate --from /path/to/old/workspace --apps board,knowledge --json
```

Migration copies only `.mim/packages/<app>/data`. It does not copy sessions,
traces, app runs, or local enablement.

## Backup And Restore

Backups are inspectable directories. They include served structured `.mim` state
(`packages`, `sessions`, `traces`, `settings.json`, `workspace.json`) plus the
per-workspace serve config (`callers.json`, denial ledger).

```bash
mim serve backup create --output /backups/mim-workspace-2026-07-08 --json
mim serve backup restore --from /backups/mim-workspace-2026-07-08 --workspace /srv/mim/workspace --json
```

Git-tracked workspace files are not included; use git for those.

## Network Safety

Web reads reject private, loopback, link-local, unique-local, and cloud metadata
addresses by default. Tests and local development can opt into private addresses
only through the explicit URL-policy escape hatch.

When proxying `/mcp/events`, disable response buffering and keep idle timeouts
long enough for SSE. For Caddy, use a reverse-proxy config that does not buffer
event-stream responses.

## Source

- Serve token store and grants: `src/main/serve/tokens.ts`
- Invite store and redemption: `src/main/serve/invites.ts`
- Denial ledger: `src/main/serve/denials.ts`
- State migration: `src/main/serve/stateMigration.ts`
- Backup/restore: `src/main/serve/backup.ts`
- Serve startup: `src/main/serve/start.ts`
- Desktop/headless shared-workspace client and invite join:
  `src/main/workspace/sharedWorkspace*.ts`
- HTTP MCP route and SSE notifications: `src/main/server/server.ts`
- CLI: `src/main/cli.ts`
