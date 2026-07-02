# Custom Apps

Custom apps are how a workspace teaches Mim a durable capability. The user goal
is not "install an app"; it is "Mim should know how to do this recurring
task from now on." Skills and apps are the implementation choices.

Use this guide when deciding what to build, explaining the workflow to a user,
or debugging why a custom capability is not visible in chat.

## The User Path

A user should be able to describe the capability in plain language:

```text
I want Mim to monitor my GitHub PRs and tell me what needs review.
```

The agent should translate that into the smallest durable abstraction:

| Need | Build |
|---|---|
| Persistent instructions for chat | Workspace skill in `skills/<name>/SKILL.md` |
| Custom logic, data, HTTP, secrets, jobs, or UI | App in `packages/<id>/` |
| Instructions plus executable behavior | App with bundled skill |

Keep app vocabulary out of the main conversation unless the user is asking
about implementation details. Report the result as a capability: "You can now
ask Mim `what PRs need review?`"

## Self-Building With Mim

When a user wants to build their own app, point them to Chat first:

1. Describe the recurring task and the desired prompt.
2. Say whether it needs external services, secrets, local files, long-running
   work, or a visual surface.
3. Let the `build-app` skill choose skill-only, headless app, UI app,
   or app plus bundled skill.
4. Review any trust or secret setup in Settings > Apps.
5. Test the final user prompt in chat.

Settings includes starter paths for small manual builds:

- Settings > Skills > Add > New Personal skill from template opens a template
  selector with Blank skill, Review Checklist, and House Style. Template
  creation writes a full skill folder, including bundled reference files when
  the template has them, then reveals the folder and shows a confirmation
  toast.
- Settings > Apps > New app creates a workspace app from the selected template.
  The UI renders the template in the main process, calls `package.create`,
  runs `package.validate`, only reloads packages when validation passes, then
  reveals the new app folder and shows a confirmation toast.

Disabling a workspace app removes it from the current user's sidebar and
capability set, but leaves the app folder installed and visible under Settings
> Apps > Workspace Apps. Removing a workspace app is a separate action.

Good self-build prompts:

```text
Teach Mim how to check my team's PRs and summarize blockers every morning.
```

```text
Create a custom app that reads CSV exports from reports/ and flags anomalies.
```

```text
Make a persistent workspace skill for how we triage customer escalations.
```

## What A Complete App Includes

A chat-native app should normally include four things:

- Named tools in `mim.provides.tools`, so chat can call the app.
- Backend `tools` or `jobs`, so the capability has executable behavior.
- An app skill in `skills/<name>/SKILL.md`, so chat knows when to use it.
- `agentContext` when the app has current state worth carrying into future
  sessions.
- A root `README.md`, so humans can inspect setup and usage.

Headless apps are preferred when chat tools or jobs are enough. Add UI only
when the user needs a visual control surface, review surface, or persistent app
surface.

## Authoring Loop

The agent-facing loop is:

For starter scaffolds, use `app.templateList`/`app.templateContent` when one
fits. For custom scaffolds, create the package directly.

```text
package_create
package_validate
package_reload
app_status
app_enable
package_capabilities_list
package_tools_execute or package_jobs_start
```

`package_validate` closes the "did it load?" gap before reload. It checks the
manifest, referenced files, backend importability, app skills, named-tool
grants, and permission hints.

`package_reload` closes the "I edited the backend but nothing changed" gap. It
rescans apps, invalidates backend import caches, and syncs named tools.

Do not call the work done until the app is enabled, the expected tools or
jobs appear in capabilities, and a representative tool or job has been tested.

## Trust, Secrets, And Permissions

Workspace apps with backend code or sensitive permissions require user trust
before they can run. The agent cannot grant trust for the user. If `app_status`
or `app_enable` reports that trust is needed, ask the user to review and trust
the app in Settings > Apps.

Declare only the permissions the app uses:

- `workspace.read` for reading workspace files.
- `workspace.write` for writing workspace files.
- `http` for exact HTTPS hosts used through `ctx.http`.
- `secrets` for keychain secret names used through `ctx.secrets`.
- `ai` for backend AI helper usage.

Secrets live in the OS keychain. An app UI can set, delete, and check secret
status, but cannot read secret values.

## Debugging Checklist

If chat does not know about the new capability:

- Confirm the relevant skill is visible with `skill.list`.
- Confirm the app is enabled with `app_status`.
- Run `package_validate` and fix every error.
- Run `package_reload` after backend or manifest edits.
- Confirm named tools appear in `package_capabilities_list`.
- Test a tool with `package_tools_execute`.
- Check whether Settings > Apps requires user trust or secret setup.

If the app validates but tools do not appear, compare `mim.provides.tools`
names with backend `tool.name` fields. They must match the grant.

## Distribution

Workspace apps live in the workspace and are available to collaborators who
open it. To distribute apps beyond a workspace:

- **Public apps** go into `shoulders-ai/mim-apps`, one per `packages/<id>/`.
- **Private apps** go into `mim-web/packages/<id>/` and are delivered through
  the authenticated account registry. See [private-registry.md](private-registry.md).

## Implementation References

- App contract and SDK details: [app-system-api.md](app-system-api.md)
- Skills format and activation: [skills.md](skills.md)
- AI tool gating and wrappers: [ai-tools.md](ai-tools.md)
- Private registry: [private-registry.md](private-registry.md)
