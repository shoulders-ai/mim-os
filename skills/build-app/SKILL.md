---
name: build-app
description: Use when the user wants to teach Mim a recurring capability, create or debug a workspace skill, create or debug a Mim package, add chat-callable tools/jobs/UI/data/HTTP/secrets, or understand why a package, tool, job, or skill did not load.
tools: [package_create, package_edit, package_validate, package_reload, package_list, app_status, app_enable, package_capabilities_list, package_tools_execute, package_jobs_start]
unlocks: [package_create, package_edit, package_delete, package_validate, package_reload, package_list, package_readme, app_status, app_enable, package_capabilities_list, package_tools_execute, package_jobs_start]
---

# Build App

Treat the request as "teach Mim a permanent capability", not "make a package".
The package system is implementation detail. Keep the conversation in capability
terms: what the user can ask Mim to do after the work is complete.

## Triage

Choose the smallest durable abstraction that solves the user's recurring task:

- Persistent instructions only: create a workspace skill at `skills/<name>/SKILL.md`.
- Custom logic, data, HTTP, secrets, jobs, or UI: create a package under `packages/<id>/`.
- Both: create a package and include a package skill under `packages/<id>/skills/<name>/SKILL.md`.

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

## Package Work

Use a package when the capability needs new executable behavior:

- named chat tools
- backend jobs
- package data
- HTTP calls
- secrets
- package UI
- generated artifacts

Prefer a headless package when chat tools/jobs are enough. Add UI only when the
user needs a visual control surface or review surface.

Every chat-native package should include:

- Named tools in `mim.provides.tools` and matching backend `tool.name` fields.
- A package skill so Mim knows when to use those tools.
- An `agentContext` export when current package state should appear in future sessions.
- A root `README.md` for human-facing usage and setup notes.

## Create Pattern

Use `package_create` for first scaffolds. Include all generated content in one
call whenever possible:

- `backend`: content for `backend/index.mjs`.
- `skills`: array of `{ name, content }` for package skills.
- `readme`: root `README.md`.
- `permissions`: manifest permissions, such as HTTP hosts and secrets.
- `provides`: named tool grants, such as `{ tools: [{ name, category, risk }] }`.
- `dataFolder`: workspace data folder name when the app stores user-visible data.
- `html` and `js`: only when creating a UI package.

For headless packages, omit `html`; the manifest will use `views: []`.

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

Use this loop for every package:

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

## Trust Boundary

Workspace packages with a backend or permissions require user trust before they
can run. `app.trust` is user-only and cannot be called by the agent. If
`app_status` says `needsTrust: true` or `app_enable` says trust is needed, stop
the execution loop and ask the user to review and trust the package in Settings
> Apps. Continue only after trust has been acknowledged.

## Jobs Versus Tools

Use a tool for quick, chat-callable actions that return directly.

Use a job for long work, cancellable work, progress events, durable run records,
or artifact generation. Jobs should emit progress around expensive steps.

## Permissions

Declare only what the package needs:

- `workspace.read`: read workspace files.
- `workspace.write`: write workspace files.
- `http`: exact HTTPS hosts or wildcard subdomains used by `ctx.http`.
- `secrets`: keychain secret names used by `ctx.secrets`.
- `ai`: backend AI helpers through `ctx.ai`.

If a backend uses `ctx.http`, `ctx.secrets`, `ctx.ai`, or workspace reads/writes
without declaring permissions, `package_validate` should warn. Fix the manifest
or remove the behavior.

## UI Packages

Package UI files must live under `ui/`. Use the SDK from package iframe code:

```js
import { runtime } from '/sdk/mim.js'
await runtime.ready
await runtime.jobs.start('jobId', { input: true })
await runtime.data.kv.set('key', value)
await runtime.call('workbench.openWork', { packageId: runtime.package.id })
```

Use SDK helpers (`runtime.jobs`, `runtime.data`, `runtime.secrets`) over raw
`runtime.call()` when helpers exist.

## Reporting

End with capability language:

- What Mim now knows how to do.
- The exact user prompt that should work.
- Any remaining trust, secret, or account setup.
- What was validated and what was tested.
