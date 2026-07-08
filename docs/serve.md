# Mim Serve

`mim serve` hosts one workspace from a headless Node process over authenticated
MCP HTTP. It is the shared-workspace entrypoint for a VPS, lab machine, or other
always-on host.

## Quick Start

```bash
# On the server workspace
mim serve token create --name anna --json
mim serve --host 0.0.0.0 --port 4780
```

Token creation prints ready-to-paste Claude, Codex, Gemini, and `curl` snippets.
Tokens are shown once; rotate a lost token instead of trying to recover it.

```bash
mim serve token list --json
mim serve token rotate caller_... --json
mim serve token revoke caller_...
```

## MCP HTTP

Serve mode exposes:

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
- Denial ledger: `src/main/serve/denials.ts`
- State migration: `src/main/serve/stateMigration.ts`
- Backup/restore: `src/main/serve/backup.ts`
- Serve startup: `src/main/serve/start.ts`
- HTTP MCP route and SSE notifications: `src/main/server/server.ts`
- CLI: `src/main/cli.ts`
