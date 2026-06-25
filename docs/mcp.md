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
"..." }`. The desktop binds the connection as `actor: "ai"` with the MCP
session id.

The curated tool surface is enforced in `src/main/server/server.ts` before
`tools.call()`. The stdio bridge also maps only curated MCP names, but that is
not the security boundary because local processes can speak WebSocket directly
if they have the bearer token.

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
