---
name: build-app
description: Use when the user wants to teach Mim a recurring capability, create or debug a workspace skill, create or debug a Mim app, add chat-callable tools/jobs/UI/data/HTTP/secrets, or understand why an app, tool, job, or skill did not load.
tools: [package_create, package_edit, package_validate, package_reload, package_list, app_status, app_enable, package_capabilities_list, package_tools_execute, package_jobs_start]
unlocks: [package_create, package_edit, package_delete, package_validate, package_reload, package_list, package_readme, app_status, app_enable, package_capabilities_list, package_tools_execute, package_jobs_start]
---

# Build App

Treat the request as "teach Mim a permanent capability", not "make an app".
The app system is implementation detail. Keep the conversation in capability
terms: what the user can ask Mim to do after the work is complete.

## Triage

Choose the smallest durable abstraction that solves the user's recurring task:

- Persistent instructions only: create a workspace skill at `skills/<name>/SKILL.md`.
- A specialised assistant with its own prompt/tools/model: create an app with an `agents` export.
- Custom logic, data, HTTP, secrets, jobs, or UI: create an app under `packages/<id>/`.
- Both: create an app and include an app skill under `packages/<id>/skills/<name>/SKILL.md`.

Use a skill to shape the main chat's default behavior. Mount an agent only
when the capability needs a separate identity: its own sessions and history,
tool scope, model, or persona.

Ask at most one or two clarifying questions when the answer changes the
abstraction, permissions, or external account setup. Otherwise proceed.

## Skill-Only Work

Use a workspace skill when Mim only needs durable instructions, domain rules,
or a repeatable workflow using existing tools.

Create `skills/<name>/SKILL.md` with YAML frontmatter:

```markdown
---
name: short-hyphen-name
description: Use when the user asks for ...
tools: [optional_descriptive_tool_names]
unlocks: [optional_gated_tool_names]
---

# Skill Title

Follow these steps...
```

Keep the skill concise and behavioral. Put trigger details in `description`,
not in the body.

## App Work

Use an app when the capability needs new executable behavior:

- named chat tools
- backend jobs
- app data
- HTTP calls
- secrets
- app UI
- generated artifacts

Prefer a headless app when chat tools/jobs are enough. Add UI only when the
user needs a visual control surface or review surface.

Every chat-native app should include:

- Named tools in `mim.provides.tools` and matching backend `tool.name` fields.
- An app skill so Mim knows when to use those tools.
- An `agentContext` export when current app state should appear in future sessions.
- A root `README.md` for human-facing usage and setup notes.

## Create Pattern

Use `package_create` for first scaffolds. Include all generated content in one
call whenever possible:

- `backend`: content for `backend/index.mjs`.
- `skills`: array of `{ name, content }` for app skills.
- `readme`: root `README.md`.
- `permissions`: manifest permissions, such as HTTP hosts and secrets.
- `provides`: named tool grants, such as `{ tools: [{ name, category, risk }] }`.
- `dataFolder`: workspace data folder name when the app stores user-visible data.
- `html` and `js`: only when creating a UI app.

For headless apps, omit `html`; the manifest will use `views: []`.

Named tools need both sides:

```js
// package.json mim block
"provides": { "tools": [{ "name": "prs.list", "category": "read", "risk": "low" }] }

// backend/index.mjs
export const tools = {
  list: {
    name: 'prs.list',
    description: 'List pull requests needing attention.',
    inputSchema: { type: 'object', properties: {} },
    async execute(ctx, input) { return { prs: [] } }
  }
}
```

## Dev Loop

Use this loop for every app:

1. Create or edit files.
2. Run `package_validate`.
3. Fix every error. Treat warnings as product decisions, not noise.
4. Run `package_reload` so backend edits and named tools take effect.
5. Check `app_status`.
6. Enable with `app_enable` if installed and trusted.
7. Check `package_capabilities_list`.
8. Test a named tool with `package_tools_execute` or a job with `package_jobs_start`.
9. Report success in user terms: "You can now ask Mim ...".

Do not claim the capability is ready until validation is clean enough, the app
is enabled, capabilities are visible, and at least one representative tool or
job has been tested.

## Agent Apps

A headless app can mount agents via `export const agents` in the backend.
After `package_validate` and `package_reload`, the agent row appears in the
sidebar. Each agent runs in its own chat sessions.

Agent descriptor fields:

- `name` (string) — sidebar label.
- `icon` (string, optional) — short text token.
- `model` (string, optional) — default model id; user picker still wins.
- `tools` (string[], optional) — canonical tool id allowlist intersected with
  Settings > Tools. Omit for full chat tools.
- `skills` (string[], optional) — app skill names pre-activated each turn.
- `instructions(ctx)` (required) — returns the system prompt string. `ctx`
  is constrained: `ctx.package`, `ctx.data` (kv.get/keys,
  collection.get/list), `ctx.files.readPackageText`, `ctx.abort`. No
  tools.call, http, secrets, ai, or writes. 3s budget; failure names the
  agent. The returned string resolves template vars (`{{WORKSPACE_TREE}}`,
  `{{TOOL_SET}}`, etc.). Rule: compute at action time, read at prompt time.

Agent id format: `package:<packageId>/<key>`.

## Trust Boundary

Project and Team apps with a backend or permissions require user trust before they
can run. `app.trust` is user-only and cannot be called by the agent. If
`app_status` says `needsTrust: true` or `app_enable` says trust is needed, stop
the execution loop and ask the user to review and trust the app in Settings
> Apps. Continue only after trust has been acknowledged.

## Jobs Versus Tools

Use a tool for quick, chat-callable actions that return directly.

Use a job for long work, cancellable work, progress events, durable run records,
or artifact generation. Jobs should emit progress around expensive steps.

## Permissions

Declare only what the app needs:

- `workspace.read`: read workspace files.
- `workspace.write`: write workspace files.
- `http`: exact HTTPS hosts or wildcard subdomains used by `ctx.http`.
- `secrets`: keychain secret names used by `ctx.secrets`.
- `ai`: backend AI helpers through `ctx.ai`.

If a backend uses `ctx.http`, `ctx.secrets`, `ctx.ai`, or workspace reads/writes
without declaring permissions, `package_validate` should warn. Fix the manifest
or remove the behavior.

## UI Apps

App UI files must live under `ui/`. Use the SDK from app iframe code:

```js
import { runtime } from '/sdk/mim.js'
await runtime.ready
await runtime.jobs.start('jobId', { input: true })
await runtime.data.kv.set('key', value)
await runtime.call('workbench.openWork', { packageId: runtime.package.id })
```

Use SDK helpers (`runtime.jobs`, `runtime.data`, `runtime.secrets`) over raw
`runtime.call()` when helpers exist.

**Styling.** Always include `<link rel="stylesheet" href="/sdk/tokens.css">` and use CSS vars for all colors, fonts, spacing, and radii — never hardcode visual values. This ensures apps follow the user's chosen theme. Key vars: `--color-ink`, `--color-ink-2`, `--color-surface`, `--color-chrome`, `--color-accent`, `--color-rule`, `--font-sans`, `--font-mono`, `--radius-md`, `--space-sm`/`--space-md`.

## Reporting

End with capability language:

- What Mim now knows how to do.
- The exact user prompt that should work.
- Any remaining trust, secret, or account setup.
- What was validated and what was tested.
