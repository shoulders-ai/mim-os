# Spec: your first workspace (order 3)

Purpose: the reader creates a workspace, understands what appeared on disk, has a
first exchange with the agent, and meets an approval prompt without alarm. Ends the
implicit "getting started" arc.

## Outline

- A workspace is a folder on your machine holding one project. Mim opens one
  workspace at a time; switch via the workspace switcher. Creating/opening/cloning
  (verify the exact dialog options in `AddProjectDialog.vue`).
- What Mim adds to the folder: `mim.yaml` (the workspace contract), `AGENTS.md`
  (instructions the agent always follows — yours to edit), `.mim/` (Mim's own records:
  chats, file history; gitignored). One sentence each, user vocabulary.
- Opening an existing folder: the init banner offers to set the workspace up
  (verify behavior in `InitWorkspaceBanner.vue` / workspace contract source).
- First chat: ask for something real (e.g. summarize a file). The agent reads, writes,
  and runs things through tools; when an action is consequential you are asked first.
  Describe the approval card at reader level; depth → [privacy & security](privacy-security).
- Files surface: browse, open, import by drag-and-drop.
- Trapdoor: `mim.yaml` schema pointer → /develop.

## Boundaries

No editor features (→ writing). No terminal (→ running code). No approval-mode
matrix (→ privacy & security). No git sync (→ history & recovery).

## Sources

- src/main/workspace/workspaceContract.ts
- src/renderer/components/AddProjectDialog.vue
- src/renderer/components/InitWorkspaceBanner.vue
- README.md (Concepts)
- docs/workbench-navigation.md

## Length

800–1200 words.
