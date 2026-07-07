# Agents as Apps

Status: implemented (phases 0-4; phase 5 deferred).

Specialised agents become a first-class app contribution: an app mounts an
agent (prompt + tool scope + model + skills, defined in normal JavaScript),
and the agent runs in the native chat surface with everything the main
chatbot has — streaming, approvals, sessions, history, cost tracking, model
picker. The agent loop itself becomes a core primitive; the main chat is its
first consumer.

## Principles

- **Schemas guard, code acts, prose instructs.** The agent descriptor is a
  mounting bracket (identity, defaults, scope). Everything load-bearing is
  code (`instructions(ctx)`, named tools) or prose (the prompt, skills).
  No field of the descriptor may become the capability ceiling.
- **Agent #0 is our chat.** The extracted `AgentProfile` runtime drives the
  built-in chat and inline profiles first. App-mounted agents get automatic
  feature parity forever; the primitive cannot rot.
- **Agents execute in the shell, not in iframes.** Actor stays `ai`; every
  tool call passes the permission gate; approval cards render only in the
  trusted shell surface. Apps define agents, they do not host them.
- **One kind, no cliff.** There is no standalone prompt-only agent format.
  The trivial agent is a headless app with only an `agents` export — created
  conversationally via `package.create` in one pass.

## Descriptor (backend export)

```js
export const agents = {
  referee: {
    name: 'Lancet Referee',
    icon: 'LR',                       // optional, app-icon rules apply
    model: 'claude-opus-4-8',         // optional default, user picker still wins
    tools: ['fs.read', 'search.files', 'stats.check'],  // optional allowlist
    skills: ['review-methods'],       // app skills pre-activated each turn
    async instructions(ctx) {         // the harness: normal JS, app ctx
      const prior = await ctx.data.collection('reviews').list()
      return `You are a statistics referee... {{WORKSPACE_TREE}}`
    }
  }
}
```

- Agent id: `package:<packageId>/<key>` (same convention as app skills).
- `instructions(ctx)` receives a constrained **`AgentInstructionsContext`**,
  not the full app runtime ctx. Prompt assembly is a read hook, not an
  execution hook: it gets `ctx.package`, read-only app data
  (`kv.get`/`kv.keys`, `collection.get`/`collection.list`),
  `ctx.files.readPackageText`, and an abort signal — no `tools.call`, no
  `http`, no `secrets`, no `ai`, no workspace reads, no writes. It runs
  under a 3-second budget (same as `agentContext`) and is audited as an
  `agent.instructions` span under the turn trace. The rule for richer
  context: **compute at action time, read at prompt time** — the app's
  tools and jobs (which run with full ctx, permissions, and audit) persist
  state into `ctx.data`; `instructions` reads it back.
- The returned string passes through `resolveTemplateVars` with the same
  variables as `AGENTS.md` (`{{TOOL_SET}}`, `{{WORKSPACE_TREE}}`,
  `{{SKILL_CATALOG}}`, `{{PROJECT_LOG}}`, ...), so agents compose the same
  context our own prompt template can. Failure or timeout fails the turn
  with an error naming the app and agent — no silent fallback prompt.
- `tools` narrows: the visible set is the allowlist intersected with the
  Settings > Tools policy. Omitted means the full chat tool set. The `skill`
  activation tool is always present when the agent has skills; skill
  `unlocks` gating still applies within the allowlist. An agent can never
  see a tool the user's policy disabled.
- `tools` entries must be canonical registry tool ids (core dotted names or
  the app's own granted named tools). Unknown ids are load-time diagnostics,
  not silent no-ops; an allowlisted tool that is missing at runtime (e.g. a
  disabled dependency app) is a diagnostic and omitted. Settings > Apps
  shows the scope honestly: "Full chat tools" vs "Scoped: N tools" — a
  specialised agent must never silently behave like general chat.
- Trust: agents are backend exports, and backends already require the
  workspace trust ack — an installed prompt steers the AI as surely as code.
  This invariant gets a test, not an exemption.

## Naming

"Agent" is authoring vocabulary: the `agents` backend export, the
`AgentProfile` runtime type, the **Agent** starter template. The UI never
introduces it as a category: the sidebar row is the app (its name, its
icon), and its conversations are ordinary chat sessions carrying the app's
identity — History shows "Lancet Referee", not "agent session". The phrase
"agent session" remains exclusively the CLI coding-agent concept
([agent-sessions.md](../agent-sessions.md)); no surface of this feature uses
it.

## Phases

### Phase 0 — Close the `/api/ai/*` iframe hole

App iframes are sandboxed `allow-same-origin` on the server origin, so any
app UI can `fetch('/api/ai/chat')` today and drive the full main agent —
bypassing manifest `ai` permission and tool scoping. Fix before building the
sanctioned path.

- Main generates a per-boot shell token, delivered to renderer windows
  (main + pop-outs) through the preload/`aiApi` config path that already
  hands out the server base URL. Iframes cannot reach preload.
- **Every** `/api/ai/*` route rejects requests without the token header:
  `chat`, `inline`, `ghost`, `task-label`, `summary` — and any route added
  later (enforce as route-prefix middleware, not per-handler checks).
- Token attachment lives in one shared AI fetch helper in
  `src/renderer/services/ai/`; all five callers (ChatView transport, inline,
  ghost, taskLabel, summary) go through it. The CORS middleware's
  `Access-Control-Allow-Headers` gains the token header.
- Files: `src/main/server/server.ts`, `src/preload/index.ts`,
  `src/renderer/services/ai/`. Tests: `server-ai.test.ts` (401 without
  token, per route), centralRuntime source-contract tests (all AI calls use
  the shared helper).

### Phase 1 — Extract the `AgentProfile` primitive (pure refactor)

`streamProfileResponse` (`src/main/ai/aiRuntime.ts`) is already ~90% of the
runtime; its identity is just hardcoded to `'chat' | 'inline'`.

- New `AgentProfile` interface: id, instructions assembly, tool visibility
  filter, session persistence, step cap, max output tokens, temperature,
  sendReasoning, model default, skill-catalog/compaction participation.
- `streamProfileResponse(profile, tools, request)` takes an `AgentProfile`;
  built-in `chatProfile` and `inlineProfile` reproduce today's branching
  exactly. Public `streamChatResponse`/`streamInlineResponse` unchanged;
  `server.ts` untouched.
- Behavior-parity refactor: existing `ai.test.ts` /
  `callModelToolLoop.test.ts` suites pass unchanged; new tests assert the
  profile object drives each divergence point (prompt, tools, caps,
  persistence).

### Phase 2 — Mount app agents

- `src/main/packages/packageRuntime.ts`: parse `export const agents` in
  `importCapabilities` beside jobs/tools/agentContext; validation
  diagnostics for bad descriptors; expose in `PackageCapabilities` and
  `package.capabilities.list` ("Provides an agent" beside "Teaches the
  agent" in Settings > Apps).
- New `src/main/ai/agentMounts.ts`: resolve enabled apps' agent descriptors
  into `AgentProfile`s (id `package:<pkg>/<key>`); build the app ctx for
  `instructions`; template-var resolution; tool-allowlist intersection;
  per-turn pre-activation of declared skills via the existing
  `activateSelectedSkillsFromRegistry` path.
- Trace: `chat.turn` spans carry `agentId`.
- Tests: `packageRuntime.test.ts` (parsing, diagnostics),
  `aiRuntime.test.ts` (mounted profile: prompt assembly, narrowing, model
  default, failure-names-agent), `gate.test.ts` addition (agent tool calls
  are actor `ai`, gated normally). Run `npm run test:packages:compat`.

### Phase 3 — Sessions, endpoint, renderer surface

- `src/main/sessions.ts` + `sessionManifest.ts`: optional `agentId` on the
  session record and manifest cache.
- `/api/ai/chat` accepts `agentId`; `streamChatResponse` resolves the
  mounted profile (unknown/disabled agent → clear error).
- `ChatView.vue`: session's `agentId` travels in
  `prepareSendMessagesRequest` body (beside `skills`); new-session-for-agent
  flow; header shows agent name; model picker defaults to the descriptor
  model.
- Sidebar: enabled apps with agents contribute agent rows in the Apps
  section; click opens the latest agent session or starts one in the chat
  surface. History/Activity rows show the app's name and icon. Command
  palette gains "New <app name> chat".
- Tests: sessions tests, appShell/workbench adapter tests, sessions-store
  filtering, ChatView contract tests.

### Phase 4 — Authoring: template, skill, docs

- `src/main/templates/appTemplates.ts`: **Agent** starter — headless app
  with an `agents` export, one bundled skill, README. `templates.test.ts`.
- `build-app` skill: decision-table row ("a specialised assistant with its
  own prompt/tools/model → app with an `agents` export") and authoring-loop
  note (`package.validate` → `package.reload` → agent row appears).
- Boundary rule, stated in `custom-apps.md` so the choice stays crisp:
  **use a skill to shape the main chat's default behavior; mount an agent
  only when the capability needs a separate identity — its own sessions and
  history, tool scope, model, or persona.** A headless agent-only app is the
  lighter of the two only when that separation is the point.
- Docs: Agents section in `app-system-api.md`, decision table in
  `custom-apps.md`, `_MAP.md` rows, `gotchas.md` if warranted.

### Phase 5 — Embeddable `<mim-chat>` (deferred)

A custom-element bundle of the chat surface for apps that need the chat
block inside their own UI. Approval cards still render only in the shell,
and the runtime accepts approval decisions only from the shell. Not designed
further until a real app pulls for it.

## Open decisions

- Descriptor `model` is a default, not a lock (v1). Revisit if a real agent
  needs enforcement.
- Agent rows live in the Apps sidebar section (v1); a dedicated Agents
  section only if row count demands it.
