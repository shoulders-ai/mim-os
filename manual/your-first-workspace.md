---
id: your-first-workspace
title: your first workspace
order: 3
sources:
  - src/main/workspace/workspaceContract.ts
  - src/renderer/components/AddProjectDialog.vue
  - src/renderer/components/InitWorkspaceBanner.vue
  - README.md
  - docs/workbench-navigation.md
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# your first workspace

A workspace is a folder on your machine that holds one project. Mim opens one workspace at a time.

## Creating a workspace

The workspace switcher sits at the top of the Navigator. Click it to see your recent workspaces and three ways to start:

::: rows
- Open Folder... -- pick an existing folder from your filesystem.
- New Folder... -- create an empty folder in a parent directory you choose. The dialog asks for a parent directory and a folder name.
- Clone Repository... -- clone a git repository. The dialog asks for a repository URL, a destination directory, a folder name, and an optional access token for private repos.
:::

When you open an empty folder or create a new one, Mim recognizes it has no workspace files yet.

## What Mim adds

When a workspace is initialized, Mim creates four things in the folder:

::: rows
- `mim.yaml` -- the Project contract. It holds the Project name and optional
  managed-sync configuration. You can edit it by hand or let Mim manage it.
- `AGENTS.md` -- standing instructions the agent follows in every chat. Yours to edit. The default template describes the workspace layout, available tools, and basic conventions. Add your own project context, domain rules, or constraints and the agent will respect them.
- `CLAUDE.md` -- a pointer file that references `AGENTS.md`. CLI agents that read `CLAUDE.md` get the same instructions Mim's agent does.
- `.mim/` -- Mim's own runtime data: chat history, file history, and workspace state. This directory is added to `.gitignore` automatically and never committed.
:::

The first three files are part of your project. Commit them to version control and collaborators who open the same folder in Mim get the same workspace contract.

## Opening an existing folder

If you open a folder that has not been initialized, a banner appears at the top of the workspace: "Workspace not initialized". Two options:

::: rows
- Initialize -- creates the workspace files described above without touching your existing files.
- Dismiss -- hides the banner until the workspace is reopened.
:::

Mim never modifies your existing files during initialization. It only adds its own.

## Your first chat

Select Chat in the Navigator to open a new chat. Type a request -- ask the agent to summarize a file in your workspace, draft an outline, or look something up. Press <kbd>Cmd+N</kbd> to start a new chat at any time.

The agent works through tools: it can read files, write files, search your workspace, and run commands. When it uses a tool, you see what it did and what it produced. Most read operations happen without interruption. When an action would change something -- editing a file, creating a new one, running a shell command -- Mim pauses and asks for your approval.

The approval card shows exactly what the agent wants to do. It names the action (for example, "Allow Mim to edit a file?"), displays the target path, and summarizes the proposed change. You have two choices -- and, for file edits, a third:

::: rows
- Approve -- let the action proceed.
- Decline -- block the action. The agent sees the refusal and adjusts.
- Review change -- when the action is a file edit, open a diff view of the proposed change before deciding.
:::

A collapsible details section shows the underlying tool name and parameters. An "Always allow" option grants permission for that kind of action for the rest of the current chat, so future calls of the same type proceed without asking. The full approval model -- which actions require approval, how to configure standing permissions, and how the audit trail works -- is covered in [privacy & security](privacy-security).

::: note
Declining is not an error. The agent treats a declined action as information and continues the chat.
:::

## The files surface

Select Files in the Navigator to browse your workspace. The toolbar offers three views:

::: rows
- Browse -- a tree of every file and folder in the workspace.
- Recent -- files ordered by when you last opened them.
- Changed -- the latest fetched Project and Team changes, with author and
  commit summary.
:::

A search field at the top searches by file name and content. To import files from outside the workspace, drag them from Finder or your file manager into the files view. A drop overlay confirms the import destination.

Opening a file from the files surface places it in the editor. The files surface is for navigation; editing, formatting, and export are covered in [writing](writing).

When you connect a [team](team), its shared `files/` folder appears here under
the Team's name. Your Project files stay in place.

::: under-the-hood
The `mim.yaml` file is a YAML document. Its schema supports the Project name
and optional managed-sync settings. A minimal file contains only `name`:

```yaml
name: my-research-paper
```

The full schema is documented in [workspace contract](/develop/workspace-contract).
:::
