---
id: mcp
title: MCP bridge
order: 6
sources:
  - docs/mcp.md
  - src/main/mcp/stdio.ts
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# MCP bridge

Mim exposes a local MCP stdio server that bridges external CLI agents to the running desktop app. It does not boot the headless kernel -- the desktop owns the workspace, approval gate, trace logging, local history, and export renderer.

## Connection model

```text
Claude Code / Codex / Gemini CLI
    stdio JSON-RPC 2.0
mim mcp
    WebSocket JSON-RPC
Mim Desktop
    Tool registry
```

Pi 0.76+ uses a direct adapter instead of stdio MCP:

```text
Pi
    bundled Mim extension (WebSocket JSON-RPC)
Mim Desktop
    Tool registry
```

On desktop start, Mim writes `~/.mim/server.json` with a port and bearer token. The file is written atomically with owner-only permissions. On quit, Mim deletes it best-effort.

Agent sessions launched from Settings > Apps receive per-session `MIM_PORT` and `MIM_TOKEN` environment variables. Running `mim mcp` outside Mim falls back to `~/.mim/server.json`. Per-agent tokens are revoked when the live session exits.

## Security boundary

MCP clients identify to the desktop WebSocket with `{ "type": "mcp", "token": "..." }`. The desktop binds the connection as `actor: "user"` with the MCP session id.

The curated tool surface is enforced in `src/main/server/server.ts` before `tools.call()`. Settings > Tools filters both `__meta.tools` metadata and direct MCP execution, so a cached client cannot call a disabled tool.

## Static tools

Present in the MCP catalog when enabled in Settings > Tools:

| MCP name | Mim tool |
|---|---|
| `fs_read` | `fs.read` |
| `search_files` | `search.files` |
| `editor_open` | `editor.open` |
| `editor_state` | `editor.state` |
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
| `workspace_info` | `workspace.info` |
| `skill_list` | `skill.list` |
| `skill_get` | `skill.get` |
| `log_append` | `log.append` |
| `system_prompt` | `system.prompt` |
| `web_read` | `web.read` |
| `web_search` | `web.search` |
| `browser_open` | `web.live.open` |
| `browser_act` | `web.live.act` |
| `settings_get` | `settings.get` |
| `settings_set` | `settings.set` |

`browser_open` uses Mim's desktop Electron browser and accepts public sites plus
loopback development servers on `localhost`, `*.localhost`, `127.0.0.0/8`, and
`::1`. Follow-up `browser_act` calls operate the same MCP session. This is Mim's
browser tool, not ChatGPT's built-in Browser surface.

Connection management tools (`slack_connect`, `slack_disconnect`, `google_connect`, `google_disconnect`, `google_set_oauth_client`, `slack_status`, `google_status`) are also part of the curated surface so CLI agents can set up integrations. `settings_set` cannot write `tools`, `tools.enabled`, or `tools.disabled`.

## Conditional integration tools

Slack and Google data tools appear in the MCP catalog only when the corresponding token is configured in the OS keychain and the row is enabled in Settings > Tools.

Slack (when configured): `slack_channels`, `slack_users`, `slack_dms`, `slack_history`, `slack_replies`, `slack_search`, `slack_send`.

Google (when configured): `gmail_search`, `gmail_read`, `gmail_send`, `calendar_events`, `calendar_create`, `drive_search`, `drive_meta`, `docs_read`, `sheets_meta`, `sheets_read`, `sheets_write`, `sheets_append`.

## Dynamic app tools

Named tools from enabled apps are exposed alongside the core set. The server queries active named tool registrations at request time. Named tools without an `inputSchema` are silently excluded from the MCP catalog.

## Client setup

Settings > Apps shows a Connect button next to each installed CLI agent that supports Mim's MCP bridge. It runs the agent's native `mcp add` command:

| Agent | Command |
|---|---|
| Claude Code | `claude mcp add mim -- mim mcp` |
| Codex | `codex mcp add mim -- mim mcp` |
| Gemini CLI | `gemini mcp add mim mim mcp` |

Pi has no connection controls. Mim automatically passes its bundled extension
on launch and resume, and Settings reports **Mim tools built in**. The extension
uses the session's `MIM_PORT` and `MIM_TOKEN`, registers the enabled catalog
directly with Pi, and identifies calls as `pi`. It is not an MCP server. A
connection failure does not stop Pi; `/mim-reconnect` retries the adapter.

This is one-time setup. The equivalent JSON config for agents that accept it:

```json
{ "mcpServers": { "mim": { "command": "mim", "args": ["mcp"] } } }
```

The MCP protocol version is `2025-06-18`.
