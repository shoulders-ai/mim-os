# Spec: agents (order 9)

Purpose: everything about working with agents: Mim's built-in agent in depth, plus
CLI coding agents as first-class citizens. The book's center of gravity.

## Outline

- The built-in agent: what it can reach (files, code, web, documents — the tool set;
  refer back to earlier chapters rather than re-explaining). Long tasks run while you
  do other things; a chime can ping you when a run finishes (verify pings UI).
- Steering: model picker and effort control (verify exact UI labels); cost tracking
  per chat; context donut, compaction status row/divider, @mentions, and context
  chips in the composer (verify).
- Instructions: `AGENTS.md` is the standing contract — edit it to change how the
  agent behaves in this workspace (verify how Settings > Instructions relates).
- Skills: written workflows the agent loads when a task calls for them; where they
  come from (workspace, apps); Settings > Skills. Building your own → [apps](apps)
  chapter boundary — here only what a skill is and how it is used.
- Routines: standing workspace prompts in the Navigator. Explain Run opens the live
  chat transcript; the Automatic switch opens authority review and controls local
  automatic triggers; the action menu edits, opens, revisits, duplicates, or
  trashes a routine; routine files live under `routines/`, local state under
  `.mim/routines/`, and routine tool grants are separate from ordinary chat approvals.
- CLI agents: Claude Code, Codex, Gemini CLI, and Pi 0.76+ are detected and launch as first-class
  agent runs in the terminal — status, scrollback that survives restarts, history.
  What "detected" means for the user (verify agent catalog behavior).
- Claude Code, Codex, and Gemini CLI can reach Mim itself over the MCP bridge;
  Pi gets the same curated tools from Mim's automatically loaded direct
  extension. Explain built-in setup and `/mim-reconnect` in one paragraph;
  protocol detail → /develop.
- Trapdoor: system prompt assembly (AGENTS.md template, tool set, skill catalog,
  workspace tree) → /develop; MCP bridge setup → /develop.

## Boundaries

No key setup (→ install). No approval-mode matrix (→ privacy & security). No app
authoring (→ apps).

## Sources

- docs/agent-sessions.md
- docs/routines.md
- docs/skills.md
- docs/mcp.md
- src/main/ai/systemPrompt.ts
- src/renderer/components/chat/ (ChatComposer, ChatCompactionDivider, ModelPicker — verify labels)
- src/renderer/components/routines/RoutinesWorkView.vue
- src/renderer/stores/routines.ts
- src/renderer/stores/pings.ts
- resources/ai-models.json

## Length

1000–1400 words.
