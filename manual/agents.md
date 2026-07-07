---
id: agents
title: agents
order: 8
sources:
  - docs/agent-sessions.md
  - docs/skills.md
  - docs/mcp.md
  - src/main/ai/systemPrompt.ts
  - src/renderer/components/chat/ChatComposer.vue
  - src/renderer/components/chat/ModelPicker.vue
  - src/renderer/stores/pings.ts
  - resources/ai-models.json
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# agents

Mim has a built-in agent that can read and edit your files, run code, search the web, and work across every surface in the workspace. CLI agents -- Claude Code, Codex, and Gemini CLI -- run as first-class sessions alongside it.

## The built-in agent

The agent can reach every surface the earlier chapters introduced — documents in the editor, files on disk, the terminal, and the web. It can add inline review comments, restore earlier versions of a file from file history, and work with git. If you have connected Slack or Google, it can search and send messages through those too. Earlier chapters cover each surface; this chapter covers how to direct the agent itself.

Long tasks run in the background while you do other things. If you want to know when a chat finishes, right-click its activity row in the Navigator and choose Ping when done. A chime plays when the run settles -- whether it completes, needs your input, or hits an error. The ping stays armed across restarts until you turn it off.

## Steering

The composer sits at the bottom of every chat. Two pickers in its bottom row control the model and its reasoning level.

The model picker shows a provider icon and a short name -- Sonnet 5, 3.5 Flash, GPT-5.4, and so on. Open it to switch between any configured model. Models whose provider API key is not set appear disabled.

The control next to it adjusts the model's reasoning depth and shows the selected level. Available levels range from None or Minimal at the low end to Max at the high end, varying by model. Higher levels produce more thorough reasoning at greater cost.

The context donut beside the pickers tracks how much of the model's context window the current chat has consumed. Hover to see the percentage and token count. The tooltip also shows the estimated cost for the chat so far, formatted as a dollar amount.

Type `@` in the composer to mention a skill, a workspace file, or an app tool by name. Matching items appear in a dropdown; selecting one adds a context chip above the text field. The + menu at the bottom left of the composer offers the same items plus file attachment and the current document. Context chips are sent with that one message and do not persist into later turns.

## Instructions

`AGENTS.md` is the standing contract for any agent working in your workspace. Everything in it -- conventions, restrictions, navigation pointers -- shapes how the agent behaves on every turn. Edit it directly as a file, or open Settings > Instructions to edit it in place.

The instructions panel lists template variables the agent resolves at runtime: `{{DATE_TODAY}}`, `{{TOOL_SET}}`, `{{SKILL_CATALOG}}`, `{{AGENT_CONTEXT}}`, `{{PROJECT_LOG}}`, and `{{WORKSPACE_TREE}}`. You can use these in your own `AGENTS.md` and the agent will see the resolved values.

## Skills

A skill is a written workflow the agent loads on demand. Each skill lives in a folder containing a `SKILL.md` file with a name, a description, and optionally a list of tools it unlocks. The agent sees the skill catalog -- names, descriptions, and declared tools -- on every turn. When your request matches a skill's description, the agent activates it, loading the full instructions and making any gated tools available for the rest of the run. You can also activate a skill explicitly by adding it as a context chip in the composer.

Skills come from four sources, in increasing precedence: built-in skills that ship with Mim, added sources (local folders or git repositories), personal skills in `~/.mim/skills/`, and workspace skills in your workspace's `skills/` folder. A skill at a higher level with the same name shadows the one below it. Apps can also bundle skills; those appear under their app in Settings > Apps.

Manage your skill library in Settings > Skills. You can toggle skills on or off, add a source, import a skill from a folder, or create a new personal skill from a template. Building your own skills is covered in [skills](/develop/skills).

## CLI agents

Claude Code, Codex, and Gemini CLI are detected automatically when their binaries are installed on your machine. Detection checks the login shell's PATH, so binaries installed via Homebrew, npm, or similar tools are found without extra configuration.

Detection alone does not surface a launcher. You enable each agent under the Coding agents heading in Settings > Apps. Enabling one adds a launcher row to the Navigator's Apps section; each click starts a new agent session.

An agent session is a first-class run. It gets its own Activity row with a live status indicator -- working, needs input, idle, done, stopped, or error -- and a title that updates automatically once the agent begins a task. Scrollback is captured in the main process and persists across restarts: even if you quit and reopen Mim, the session's output is still there. When an ended session is reopened, you can resume it -- Mim passes the agent's native resume flag so it picks up where it left off. Sessions also appear in History alongside chats and app runs, and can be renamed, archived, or deleted.

The Customise disclosure in each agent's row lets you set CLI flags per workspace -- for example, passing a specific model flag or enabling the agent's own auto-approval mode. These flags are appended to the launch command every time you start a session.

## The MCP bridge

CLI agents can reach Mim itself over a local MCP connection. Mim-specific tools -- reading files, the editor, comments, file history, search, skills, web, and connected integrations -- become available to the CLI agent, under the same approval rules. File writing, shell commands, and git remain the CLI agent's own capabilities. A Connect button in the agent's row in Settings > Apps registers the MCP server with the agent's native configuration in one click. Disconnect is in the agent's Customise section.

::: under-the-hood
The system prompt is assembled from `AGENTS.md` (or a default template) with template variables resolved at each turn: the tool catalog, the skill catalog, the workspace tree, the project log tail, and a volatile workspace-context digest. The full resolution logic is in `src/main/ai/systemPrompt.ts`.

The MCP bridge runs as `mim mcp`, a stdio server that relays JSON-RPC calls to the running desktop over a local WebSocket. Launched agent sessions receive per-session `MIM_PORT` and `MIM_TOKEN` environment variables; tokens are revoked on exit.

More in [MCP bridge](/develop/mcp) and [command line](/develop/cli).
:::
