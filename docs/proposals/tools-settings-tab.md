# Tools Settings Tab

## Problem

Mim has no single place to control what AI agents can do. Connector capability toggles live in Settings > Connections, approval mode lives in the chat composer / AI settings, and MCP exposure is curated in code. A user who wants "no agent can push to git" or "disable terminal command execution" cannot express that once and trust that it applies everywhere.

CLI agents (Claude Code, Codex, Gemini CLI) use Mim through MCP, while the in-app chat uses the AI SDK tool map. Those surfaces do not expose identical tool names or identical tool sets, so the control plane must be explicit about both.

## Proposal

Add **Settings > Tools** as the workspace-level policy surface for agent tool availability.

The tab shows human-readable capability rows grouped by domain. Each row maps to one or more registry tool ids, plus the model-facing AI SDK key and MCP name where those differ. Turning a row off removes those tools from the in-app AI tool map, removes them from the MCP catalog, and blocks MCP execution even if a client tries to call a cached tool name.

Connections keeps connection lifecycle only: connect, disconnect, account status, OAuth/scopes, and credential setup. Tools owns what agents may do after a connection exists.

## Scope

- Workspace-scoped only for new policy (`.mim/settings.json`). No new global tool defaults.
- One toggle applies to all agent surfaces. No per-agent overrides in this version.
- Covers core chat tools, MCP tools, integration data tools, and named package/app tools.
- Keeps the permission gate as approval policy, not availability policy. A tool can be enabled and still require approval.
- Reads legacy connector policy only for migration/compatibility until a workspace has an explicit `tools` policy.

## Information Hierarchy

```
Settings > Tools
|
|  [Search tools...]
|
|  FILES
|    Read workspace files          On     fs.read, search.files, documents.pdf.extract...
|    Search workspace/session text On     search, search.files, search.sessions
|    Change files                  On     fs.write, fs.edit, fs.create, fs.rename
|    Delete files                  On     fs.delete
|
|  TERMINAL
|    Run commands                  On     terminal.run
|
|  GIT
|    Read repository state         On     git.status, git.diff, git.log
|    Commit changes                On     git.commit
|    Pull changes                  On     git.pull
|    Push changes                  On     git.push
|
|  WEB
|    Read URLs                     On     web.read
|    Search web                    On     web.search
|    Use live browser              On     web.live.open, web.live.act
|
|  SLACK                          Not connected
|    Read/search public channels   Off    slack.search, slack.history, slack.channels, slack.replies
|    Read private channels         Off    slack.channels private_channel scope
|    Read direct messages          Off    slack.dms
|    Send messages                 Off    slack.send
|
|  GOOGLE                         user@example.com
|    Read Gmail                    Off    gmail.search, gmail.read
|    Send Gmail                    Off    gmail.send
|    Read Calendar                 Off    calendar.events
|    Create Calendar events        Off    calendar.create
|    Read Drive / Docs / Sheets    Off    drive.search, drive.meta, docs.read, sheets.meta, sheets.read
|    Write Sheets                  Off    sheets.write, sheets.append
|
|  APPS
|    Board: issues tools           On     issues.*
|    Knowledge: knowledge tools    On     knowledge.*
|
|  SYSTEM
|    Open editor / chat UI         On     editor.open, chat.send
|    Change settings               On     settings.set, except tool policy self-unlock
```

Rows show the human label first. The exact included tool ids are shown as muted secondary text or behind a small disclosure so advanced users can audit what a toggle actually controls.

## UX Rules

- **One control plane.** If a row is off, the capability is unavailable to in-app chat and MCP agents.
- **Truthful row labels.** Do not label a row "Read files" if related read paths stay enabled. Include all equivalent tool paths or use a narrower label.
- **Connection state is visible but not controlling.** Slack/Google rows can be toggled before connection, but the group header shows "Not connected" or the account label so users know why tools are not currently usable.
- **Safe integration defaults.** Slack and Google data access default off. Outbound actions default off. This preserves the current safety model.
- **Approval remains separate.** Enabled means "agent may request/use this tool"; approval mode still determines whether a prompt appears.
- **No silent self-unlock.** Agents cannot re-enable disabled tools by calling `settings.set`.
- **Live effect.** New chats and new MCP metadata requests reflect changes immediately. Already-running model turns keep the tool set they started with.

## Data Model

New workspace setting:

```jsonc
{
  "tools": {
    "enabled": ["slack.search", "slack.history"],
    "disabled": ["git.push", "terminal.run"]
  }
}
```

Tool ids are known policy ids, usually registry ids (`ToolDef.name`) and occasionally capability ids for sub-tool permissions such as `slack.privateChannels`. They are not AI SDK keys or MCP names. Both arrays are normalized to known ids. `disabled` wins if an id appears in both arrays.

Why both arrays:

- Default-on rows need a way to become disabled.
- Default-off rows, especially Slack/Google, need a way to become enabled without making every absent value mean "on".

Effective policy:

```ts
enabled(toolId) =
  disabled.has(toolId) ? false
  : enabled.has(toolId) ? true
  : defaultEnabled(toolId)
```

## Tool Definitions

Add `src/main/tools/toolPolicy.ts` as the shared source of truth for policy evaluation. Renderer UI can import a renderer-safe definition file from `src/renderer/components/settings/toolGroups.ts`, but the main process owns enforcement and catalog normalization.

Expose small renderer-facing registry tools that are not added to AI or MCP catalogs:

- `toolPolicy.get` returns normalized rows, connection/package metadata, effective enabled states, and the raw `tools.enabled` / `tools.disabled` arrays.
- `toolPolicy.set` accepts row/tool changes, normalizes ids, writes the workspace setting, and returns the refreshed policy.

The panel should use these policy tools instead of writing raw `settings.set` directly. This keeps migration, dynamic package rows, and validation in one place.

Each row must carry every name needed to enforce and display the policy:

```ts
interface ToolPolicyRow {
  id: string
  domain: 'files' | 'terminal' | 'git' | 'web' | 'slack' | 'google' | 'apps' | 'system'
  label: string
  description?: string
  defaultEnabled: boolean
  toolIds: string[]
  aiToolKeys?: string[]
  mcpToolNames?: string[]
  connectionKey?: 'slack' | 'google'
  packageId?: string
  risk?: 'normal' | 'sensitive' | 'outbound'
}
```

Rules:

- `toolIds` are the persisted ids and execution policy ids.
- `aiToolKeys` handle AI SDK names like `git_push` that do not match `git.push`.
- `mcpToolNames` handle MCP names like `git_push` / `fs_read` where exposed.
- Dynamic package tools are generated into the Apps group from enabled package/named-tool metadata.
- Static definitions are acceptable for core rows for now, but tests must fail when a listed AI/MCP mapping points at a missing registry tool.

## Enforcement Points

### 1. AI SDK Tool Map

In `createAiSdkTools()`, build the tool map as today, then filter by `aiToolKeys` mapped back to registry ids. Do not rely on object-key comparison against `tools.disabled`; model-facing keys and registry ids differ.

Dynamic package AI tools must also check the package tool's original registry name before being added.

### 2. MCP Metadata

In `mcpToolMetadata()`, filter static MCP specs, connected Slack/Google specs, and named package specs by registry id before serializing `__meta.tools`.

### 3. MCP Execution Allowlist

Filtering metadata is not enough. `isMcpAllowed()` must also reject disabled registry ids so a cached/raw MCP client cannot call a hidden tool directly.

Special case: MCP `settings.set` must reject writes to `tools`, `tools.enabled`, or `tools.disabled`. MCP must also never expose `toolPolicy.set`. Otherwise an agent could re-enable a tool policy that was meant to constrain it.

### 4. Connector Tool Guards

Keep or replace `readSlackPolicy()` / `readGooglePolicy()` with compatibility wrappers backed by the new tool policy. The execution-layer guards for the `ai` actor should continue to exist for sensitive integration sub-capabilities like Slack DMs/private channels and Google scopes. They become a defense-in-depth check rather than the primary UI model.

### 5. Registry / Gate

Do not put the general disabled-tool check in the registry or permission gate for this version. Renderer/user/system calls still need to work, and package runtime policy is separate. The agent surfaces are AI SDK and MCP, so enforcement belongs there.

## Connector Policy Migration

The old connector keys are:

- `settings.connectors.slack.aiEnabled`
- `settings.connectors.slack.sendEnabled`
- `settings.connectors.slack.privateChannels`
- `settings.connectors.slack.directMessages`
- `settings.connectors.google.aiEnabled`
- `settings.connectors.google.gmailEnabled`
- `settings.connectors.google.gmailSendEnabled`
- `settings.connectors.google.calendarEnabled`
- `settings.connectors.google.calendarWriteEnabled`
- `settings.connectors.google.driveEnabled`
- `settings.connectors.google.sheetsWriteEnabled`

Migration rules:

- If `tools` policy already exists, it wins.
- If no `tools` policy exists, derive effective Slack/Google rows from workspace connector settings, then user-global connector config, then defaults.
- Defaults remain off for Slack/Google data and outbound rows.
- Do not drop old keys immediately. Stop writing them from the UI, keep reading them for compatibility, and remove them in a later cleanup after a release boundary.
- Update `connections_configure` or replace it with a tool-policy-aware command so AI setup flows do not write obsolete connector keys.

## UI Implementation

- Add `'tools'` to `SettingsSection` in `sections.ts`, in the AI/services group after Connections.
- Add `ToolsSettingsPanel.vue`.
- Use `MimToggle`, existing Settings row/group primitives, Tailwind utilities only.
- Load and save through `toolPolicy.get` / `toolPolicy.set`; do not duplicate migration or dynamic package logic in Vue.
- Search matches label, domain, description, registry ids, AI keys, MCP names, and package id.
- Rows for unavailable scopes stay visible but disabled with a scope/account hint.
- Connections panel keeps connect/disconnect, token/OAuth setup, account state, granted scopes, and Website Access. Remove Slack/Google AI capability toggles from Connections after Tools is wired.

## Tests

- `toolPolicy.test.ts`: default-on/default-off resolution, `enabled`/`disabled` precedence, legacy connector migration, unknown-id normalization.
- `tools/settings policy tests`: `toolPolicy.get` returns normalized static and package rows; `toolPolicy.set` writes normalized policy and rejects unknown ids.
- `aiRuntime.test.ts`: disabled registry ids remove the correct AI SDK keys, including mismatched names like `git.push` -> `git_push`; package tools are filtered by original name.
- `server.test.ts`: disabled tools are absent from `__meta.tools` and rejected by MCP execution; `settings.set` cannot write tool policy through MCP; `toolPolicy.set` is not exposed over MCP.
- `ConnectionsSettingsPanel.test.ts`: capability toggles are gone; connection lifecycle still works.
- `ToolsSettingsPanel.test.ts`: renders groups, search, connection state, default-off integrations, and persists the correct `tools.enabled` / `tools.disabled` arrays.
- Update `docs/integrations.md`, `docs/mcp.md`, and `docs/_MAP.md`.

## Implementation Steps

1. Add shared tool-policy definitions and tests.
2. Add `toolPolicy.get` / `toolPolicy.set` for the renderer.
3. Add legacy Slack/Google migration in `readToolsPolicy()`.
4. Filter AI SDK tools using explicit `aiToolKeys` mappings.
5. Filter MCP metadata and MCP execution allowlist.
6. Block MCP `settings.set` writes to tool policy and keep `toolPolicy.set` out of MCP.
7. Build Settings > Tools UI.
8. Remove Slack/Google capability toggles from Settings > Connections.
9. Update docs and run `npm run test`.
