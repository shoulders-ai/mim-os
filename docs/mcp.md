# MCP Server

Mim exposes a local MCP stdio server through:

```bash
mim mcp
```

It is a protocol bridge to the running desktop app. It does not boot the
headless kernel and does not open a workspace by itself. The desktop owns the
workspace, renderer bridge tools, approval gate, trace logging, local history,
and export renderer.

## Connection Model

```
Claude Code / Codex / Gemini CLI
    stdio JSON-RPC 2.0
mim mcp
    WebSocket JSON-RPC
Mim Desktop
    Tool registry
```

On desktop start, Mim writes `~/.mim/server.json`:

```json
{ "port": 54321, "token": "uuid" }
```

The file is auth material. It is written atomically with owner-only permissions
where the filesystem supports chmod. On app quit, Mim deletes it best-effort.
That discovery token is valid for the desktop process lifetime.

Agent sessions launched from Settings > Apps receive per-session `MIM_PORT`
and `MIM_TOKEN` environment variables. Running `mim mcp` outside Mim falls back
to `~/.mim/server.json`. Per-agent tokens are revoked when the live agent
session exits, is killed, or fails during launch after token creation.

## Security Boundary

MCP clients identify to the desktop WebSocket with `{ "type": "mcp", "token":
"..." }`. The desktop binds the connection as `actor: "user"` with the MCP
session id.

The curated tool surface is enforced in `src/main/server/server.ts` before
`tools.call()`. Settings > Tools filters both `__meta.tools` and direct MCP
execution, so a cached/raw client cannot call a disabled tool. The stdio bridge
also maps only curated MCP names, but that is not the security boundary because
local processes can speak WebSocket directly if they have the bearer token.

`packages.list` stays package-only. `__meta.tools` is MCP-only and requires
successful MCP identification.

The MCP stdio bridge returns Mim's supported MCP protocol version during
`initialize`; it does not echo future client versions. Desktop WebSocket calls
are bounded by a per-call timeout so a hung desktop request fails the MCP call
instead of blocking stdin processing forever.

## Tool Surface

MCP tool names avoid dots. The desktop returns metadata from `__meta.tools`; the
stdio bridge exposes those names to MCP clients and forwards calls to the Mim
tool names.

### Static Tools

Present in the MCP catalog when enabled in Settings > Tools:

| MCP Tool | Mim Tool |
|---|---|
| `editor_open` | `editor.open` |
| `chat_send` | `chat.send` |
| `comments_list` | `comments.list` |
| `comments_add` | `comments.add` |
| `comments_reply` | `comments.reply` |
| `comments_resolve` | `comments.resolve` |
| `history_list` | `history.list` |
| `history_restore` | `history.restore` |
| `search_sessions` | `search.sessions` |
| `pdf_extract` | `documents.pdf.extract` |
| `export_docx` | `export.docx` |
| `export_pdf` | `export.pdf` |
| `workspace_orient` | `workspace.orient` |
| `fs_read` | `fs.read` |
| `search_files` | `search.files` |
| `skill_list` | `skill.list` |
| `skill_get` | `skill.get` |
| `log_append` | `log.append` |
| `workspace_info` | `workspace.info` |
| `system_prompt` | `system.prompt` |
| `web_read` | `web.read` |
| `web_search` | `web.search` |
| `browser_open` | `web.live.open` |
| `browser_act` | `web.live.act` |
| `settings_get` | `settings.get` |
| `settings_set` | `settings.set` |
| `slack_status` | `slack.status` |
| `slack_connect` | `slack.connect` |
| `slack_disconnect` | `slack.disconnect` |
| `google_status` | `google.status` |
| `google_set_oauth_client` | `google.setOAuthClient` |
| `google_connect` | `google.connect` |
| `google_disconnect` | `google.disconnect` |

`log_append` is the MCP logbook surface; MCP does not expose `log.read`. The `system_prompt` tool resolves `{{PROJECT_LOG}}` for clients that request the full prompt.

Connection management tools (`slack_connect`, `google_connect`, etc.) and
`settings_get`/`settings_set` are part of the curated MCP surface so CLI agents
can set up integrations. `settings_set` cannot write `tools`, `tools.enabled`,
or `tools.disabled`; tool availability is user-controlled through Settings >
Tools.

The live browser tools use the desktop Electron runtime. `browser_open` creates
or reuses the MCP session's live browser context, and `browser_act` observes,
clicks, types, scrolls, waits, extracts, shows, hides, or closes that same
session.

### Conditional Integration Data Tools

Slack and Google data tools appear in the MCP catalog only when the corresponding
token is configured in the OS keychain and the corresponding row is enabled in
Settings > Tools. MCP calls use the `user` actor; the MCP allowlist plus tool
policy is the security boundary, and CLI agents have their own permission gates.

**Slack** (when token is configured):

| MCP Tool | Mim Tool |
|---|---|
| `slack_channels` | `slack.channels` |
| `slack_users` | `slack.users` |
| `slack_dms` | `slack.dms` |
| `slack_history` | `slack.history` |
| `slack_replies` | `slack.replies` |
| `slack_search` | `slack.search` |
| `slack_send` | `slack.send` |

**Google** (when OAuth token is configured):

| MCP Tool | Mim Tool |
|---|---|
| `gmail_search` | `gmail.search` |
| `gmail_read` | `gmail.read` |
| `gmail_send` | `gmail.send` |
| `calendar_events` | `calendar.events` |
| `calendar_create` | `calendar.create` |
| `drive_search` | `drive.search` |
| `drive_meta` | `drive.meta` |
| `docs_read` | `docs.read` |
| `sheets_meta` | `sheets.meta` |
| `sheets_read` | `sheets.read` |
| `sheets_write` | `sheets.write` |
| `sheets_append` | `sheets.append` |

### Dynamic App Tools

Each exposed Mim tool must have an `inputSchema`; missing schemas fail MCP
metadata generation loudly for core tools. Named tools from enabled apps are
exposed dynamically alongside the core set — the server queries the active named
tool registrations at request time. Named tools without an `inputSchema` are
silently excluded from the MCP catalog.

## Client Config

Settings > Apps shows a **Connect** button next to each installed CLI agent.
Clicking it runs the agent's native `mcp add` command behind the scenes:

| Agent | Command |
|---|---|
| Claude Code | `claude mcp add mim -- mim mcp` |
| Codex | `codex mcp add mim -- mim mcp` |
| Gemini CLI | `gemini mcp add mim mim mcp` |

This is a one-time setup — the config persists across sessions. The
**Disconnect** option is in the agent's Customise section.

Manual setup is also possible. The equivalent JSON config (for agents that
accept it):

```json
{ "mcpServers": { "mim": { "command": "mim", "args": ["mcp"] } } }
```

The `mim` binary uses built output, so run `npm run build` before local CLI
smoke tests.

## Source

- Stdio bridge: `src/main/mcp/stdio.ts`
- Discovery file helpers: `src/main/mcp/discovery.ts`
- WebSocket MCP auth and allowlist: `src/main/server/server.ts`
- CLI command: `src/main/cli.ts`
- Agent env injection: `src/main/agents/agentSessions.ts`, `src/main/pty.ts`
- Tests: `src/main/mcp/stdio.test.ts`, `src/main/server/server.test.ts`,
  `src/main/agents/agentSessions.test.ts`, `src/main/cli.test.ts`
