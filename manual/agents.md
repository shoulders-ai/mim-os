---
id: agents
title: agents
order: 9
sources:
  - docs/agent-sessions.md
  - docs/routines.md
  - docs/skills.md
  - docs/mcp.md
  - src/main/ai/systemPrompt.ts
  - src/renderer/components/chat/ChatComposer.vue
  - src/renderer/components/chat/ChatCompactionDivider.vue
  - src/renderer/components/chat/ModelPicker.vue
  - src/renderer/components/routines/RoutinesWorkView.vue
  - src/renderer/stores/routines.ts
  - src/renderer/stores/pings.ts
  - resources/ai-models.json
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# agents

Mim has a built-in agent that can read and edit your files, run code, search the web, and work across every surface in the workspace. CLI agents -- Claude Code, Codex, Gemini CLI, and Pi -- run as first-class sessions alongside it.

## The built-in agent

The agent can reach every surface the earlier chapters introduced — documents in the editor, files on disk, the terminal, and the web. It can add inline review comments, restore earlier versions of a file from file history, and work with git. If you have connected Slack or Google, it can search and send messages through those too. Earlier chapters cover each surface; this chapter covers how to direct the agent itself.

Long tasks run in the background while you do other things. If you want to know when a chat finishes, right-click its activity row in the Navigator and choose Ping when done. A chime plays when the run settles -- whether it completes, needs your input, or hits an error. The ping stays armed across restarts until you turn it off.

## Steering

The composer sits at the bottom of every chat. Two pickers in its bottom row control the model and its reasoning level.

The model picker shows a provider icon and a short name -- Sonnet 5, 3.5 Flash, GPT-5.4, and so on. Open it to switch between any configured model. Models whose provider API key is not set appear disabled.

The control next to it adjusts the model's reasoning depth and shows the selected level. Available levels range from None or Minimal at the low end to Max at the high end, varying by model. Higher levels produce more thorough reasoning at greater cost.

The context donut beside the pickers tracks how much of the model's context window the current chat has consumed. Hover to see the percentage and token count. The tooltip also shows the estimated cost for the chat so far, formatted as a dollar amount. When Mim is using a compacted model view, the tooltip shows the compacted token count while the full transcript remains visible.

When a long chat is compacted, a `Context compacted` divider marks when Mim summarized older context for the model. The divider appears after the message or reply that triggered compaction, and says whether compaction happened before the reply, after the last reply for future turns, or as a retry after the model rejected the prompt. Expanding it shows the summary sent to the model while the full transcript stays visible. During a high-context send, a temporary status row may appear while Mim checks or summarizes context before the response starts.

Type `@` in the composer to mention a skill, a workspace file, or an app tool by name. Matching items appear in a dropdown; selecting one adds a context chip above the text field. The + menu at the bottom left of the composer offers the same items plus file attachment and the current document. Context chips are sent with that one message and do not persist into later turns.

## Instructions

`AGENTS.md` is the standing contract for any agent working in your workspace. Everything in it -- conventions, restrictions, navigation pointers -- shapes how the agent behaves on every turn. Edit it directly as a file, or open Settings > Project to edit it in place.

The instructions panel lists template variables the agent resolves at runtime: `{{DATE_TODAY}}`, `{{TOOL_SET}}`, `{{SKILL_CATALOG}}`, `{{AGENT_CONTEXT}}`, `{{PROJECT_LOG}}`, and `{{WORKSPACE_TREE}}`. You can use these in your own `AGENTS.md` and the agent will see the resolved values.

## Skills

A skill is a written workflow the agent loads on demand. Each skill lives in a folder containing a `SKILL.md` file with a name, a description, and optionally a list of tools it unlocks. The agent sees the skill catalog -- names, descriptions, and declared tools -- on every turn. When your request matches a skill's description, the agent activates it, loading the full instructions and making any gated tools available for the rest of the run. You can also activate a skill explicitly by adding it as a context chip in the composer.

Skills come from Mim, Team, Personal, and Project origins. A skill at a more
specific level with the same name shadows the one below it. Apps can also
bundle skills; those appear under their app in Settings > Apps & agents.

Manage your skill library in Settings > Skills. You can toggle skills on or off, add a source, import a skill from a folder, or create a new personal skill from a template. Building your own skills is covered in [skills](/develop/skills).

## Routines

A routine is a standing prompt saved in your workspace. Open Routines in the Navigator to create one, choose a model, and choose when it runs: manually, daily, weekly, on a simple interval, after file changes, or from an external request.

Click Run to start a routine by hand. Mim opens the routine's chat transcript and runs it through the same agent surface as an ordinary chat, so assistant messages, tool calls, tool results, and approval cards appear as the run progresses. Routine runs also appear in Activity as routine rows.

Automatic routines have one switch. Turning it on first shows what will run, which agent and model it uses, and what it may do without asking; Enable automatic runs confirms that authority on this machine. Turn the switch off to stop future automatic runs without deleting the routine. Manual routines simply show Run.

Use a routine's action menu to edit all of its settings, open the Markdown definition, revisit its last run, duplicate it, or move it to the OS Trash. Edits to its schedule, model, agent, tools, approvals, run limit, or missed-run behavior require a fresh review; changing only its description or instructions does not. The definition lives under `routines/` in the workspace, while machine-local activation and run state live under `.mim/routines/`.

Routines carry their own tool and approval grants. A routine can proceed unattended only for the tools its definition grants; other consequential actions ask in that routine's chat transcript.

## CLI agents

Claude Code, Codex, Gemini CLI, and Pi are detected automatically when their binaries are installed on your machine. Detection checks the login shell's PATH, so binaries installed via Homebrew, npm, or similar tools are found without extra configuration. Pi 0.76.0 or newer is required; Settings shows the detected version and explains when an installed copy is too old or cannot be verified.

Detection alone does not surface a launcher. You enable each agent under the Coding agents heading in Settings > Apps & agents. Enabling one adds a launcher row to the Navigator's Apps section; each click starts a new agent session.

An agent session is a first-class run. It gets its own Activity row with a live status indicator -- working, needs input, idle, done, stopped, or error -- and a title that updates automatically once the agent begins a task. Scrollback is captured in the main process and persists across restarts: even if you quit and reopen Mim, the session's output is still there. When an ended session is reopened, you can resume it -- Mim passes the agent's native resume identity so it picks up where it left off. Pi uses the same Mim session id at launch and resume, making that identity deterministic. Sessions also appear in History alongside chats and app runs, and can be renamed, archived, or deleted.

The Customise disclosure in each agent's row lets you set CLI flags per workspace -- for example, passing a specific model flag or enabling the agent's own auto-approval mode. These flags are appended to the launch command every time you start a session. Mim manages Pi's session-control flags, so use Customise for options such as `--model`, not `--session-id`, resume, continue, or fork flags.

## The MCP bridge

All four CLI agents can reach Mim itself. Claude Code, Codex, and Gemini CLI use a local MCP connection; a Connect button in Settings > Apps & agents registers it with the agent's native configuration, and Disconnect lives in Customise. Pi needs no setup: Mim loads a built-in extension whenever it launches or resumes Pi, so its row says **Mim tools built in** and has no connection controls. Mim-specific tools -- reading files, the editor, comments, file history, search, skills, web, and connected integrations -- become available under the same tool policy and approval rules. File writing, shell commands, and git remain the CLI agent's own capabilities. If Pi's connection is interrupted, the Pi command `/mim-reconnect` retries it without restarting the session.

::: under-the-hood
The system prompt is assembled from `AGENTS.md` (or a default template) with template variables resolved at each turn: the tool catalog, the skill catalog, the workspace tree, the project log tail, and a volatile workspace-context digest. The full resolution logic is in `src/main/ai/systemPrompt.ts`.

The MCP bridge runs as `mim mcp`, a stdio server that relays JSON-RPC calls to the running desktop over a local WebSocket. Launched agent sessions receive per-session `MIM_PORT` and `MIM_TOKEN` environment variables; tokens are revoked on exit.

More in [MCP bridge](/develop/mcp) and [command line](/develop/cli).
:::
