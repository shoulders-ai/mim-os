---
id: apps
title: apps
order: 9
sources:
  - README.md
  - docs/custom-apps.md
  - src/main/tools/install.ts
  - src/main/tools/coreApps.ts
  - src/renderer/components/settings/AppsSettingsPanel.vue
  - src/renderer/components/MissingAppsBanner.vue
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# apps

Apps extend Mim with views in the Navigator, tools the agent can call, skills, and background jobs. Each app's views run in a sandboxed iframe, and its tool calls go through the same permission gate as every other tool.

## The catalog

Apps live in a registry that Mim browses for you. The default registry ships these apps:

::: rows
- Board — Kanban issue board.
- DOCX Review — Runs a structured academic peer-review workflow and writes comments back into a Word revision copy.
- GitHub Monitor — Org-wide GitHub issues, PRs, project boards, and activity with saved views and AI summaries.
- Import to Markdown — Convert Word, Excel, BibTeX, and selectable PDF files into AI-ready Markdown.
- Knowledge — Knowledge base.
- References — Reference library: capture by DOI, PDF, or paste; cite from a real, verifiable library.
- Scholar — Reproducible abstract-level literature search with source-grounded candidate sets.
- Slides — Generates slide decks as paginated HTML and exports a print-exact PDF.
- Word Count — Count words, characters, and lines from pasted text or a workspace text file.
:::

You can point Mim at additional registries by clicking Add source in the Browse section header and choosing a local folder that contains its own registry index.

## Adding an app

Open Settings > Apps. The panel shows two sections at the top: Apps lists everything currently enabled, and Available lists apps that are in your workspace but not yet turned on. Below both is the Browse section, which lists registry apps you have not added.

Click Add next to a registry app. Mim shows the app's access requirements — whether it reads or writes workspace files, which network hosts it contacts, whether it uses secrets or AI. Review the list and confirm. Mim installs the app and enables it in your Navigator in one step.

Every app row has a toggle. Turn it off to disable an app without uninstalling it. Turn it back on to re-enable. When a workspace app with backend code or sensitive permissions has not been reviewed on this machine, the toggle opens an access review first. You see exactly what the app can do, and you acknowledge it before it runs. This acknowledgment is stored per machine — no one else's choice affects yours.

Expand any row to see its access summary, diagnostics, and developer details. If the app ships a `README.md`, a Documentation link appears in the expanded view and opens it as a read-only tab.

To remove an app that was shared with the workspace, expand its row and click Remove from workspace. This deletes the workspace pin but keeps the install directory and any data the app created. To remove a personal app from your Navigator, expand its row and click Remove.

When an update is available for an installed app, Mim shows an Update available badge on the row. Expand the row and click the update button to install the newer version.

## Sharing with collaborators

Adding an app is personal — it appears in your Navigator only. When you want everyone who opens the workspace to have access to an app, ask the agent to share it. The agent calls `app.share`, which writes a pin into the workspace's `mim.yaml` file recording the registry source and version the workspace expects.

When a collaborator opens the workspace on a machine where pinned apps are not yet installed, Mim shows a banner at the top of the window listing the missing apps. They can click Add all — Add it, when a single app is missing — to install at once, or Dismiss to continue without the apps.

Sharing pins the app for the workspace but does not enable it in anyone's Navigator. Each person turns it on for themselves.

## Making your own

For standing instructions that shape how the agent behaves — review checklists, house style rules, triage protocols — a workspace skill is the lighter option. Skills are covered in [agents](agents).

For anything that needs executable logic, a network connection, secrets, a visual surface, or background jobs, build an app. The fastest path is Settings > Apps, then click New app. Choose a template, set an app folder ID and a display name, then click Create app. Mim renders the template into a `packages/<id>/` folder in the workspace, validates the result, reloads apps, and reveals the created folder.

From there, edit the app's files and ask the agent to reload and test it. The agent validates the manifest and backend, reloads without restarting Mim, and confirms the expected tools or jobs appear.

You can also describe the capability you want in chat and let the agent build the app for you. Tell it what recurring task you need and whether it requires external services, secrets, or a visual surface. The agent picks the right shape — skill-only, headless app, or app with UI — and builds it in your workspace.

Disabling a workspace app removes it from your Navigator and capability set but leaves the app folder in place under Settings > Apps. Removing is a separate action.

::: under-the-hood
An app is a directory with a `package.json` manifest declaring its id, views, tools, jobs, permissions, and backend entry point. The runtime connects over WebSocket and exposes the same tool registry available to the built-in agent. Named tools in the manifest make the app's capabilities callable from chat. Installs land in `~/.mim/packages/<id>/<version>/`.

More in [app system and API](/develop/app-system-api).
:::
