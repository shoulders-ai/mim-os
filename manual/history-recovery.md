---
id: history-recovery
title: history & recovery
order: 11
sources:
  - docs/history.md
  - docs/git.md
  - src/renderer/components/editor/HistoryRail.vue
  - src/renderer/components/archive/ArchiveBrowser.vue
  - src/main/tools/fs.ts
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# history & recovery

Edits by you or the agent can be undone. Mim keeps bounded local file history, preserves past chats and runs, and can manage git sync on your behalf.

## File history

Mim keeps file history under `.mim/` by default. It takes small, bounded baselines of authored text so a closed file's pre-change state survives an overwrite by an external editor. Bulk data, PDFs, Office files, images, and machine JSON streams are not baselined. Mim still records eligible data and binary files immediately before it overwrites, renames, deletes, or restores them. New downloads and imports do not get a redundant one-version history. Files in generated directories like `node_modules` or `dist` are excluded.

Settings > Project has a File recovery toggle. Turning it off asks for confirmation and stops new recovery points, but keeps existing versions available to preview or restore. Open Advanced to clear those versions explicitly or change storage limits.

File history is independent of git. Mim never reads or writes your `.git` directory on its own.

::: note
File history works in every workspace, whether or not it uses git. You do not need to commit to protect your work.
:::

To browse a file's history, click the Version history button in the editor toolbar, or right-click a file in Files and choose Version history.... The History rail opens beside the editor, showing the current file at the top — marked Current — followed by previous saves listed newest-first. Each entry shows a relative time as its primary label, a detail line describing what happened and who did it (for example, Edited by agent or Saved by you), and line-change counts compared with the current file.

Clicking a text entry previews that version read-only in the editor. A banner shows the version's age and line-change counts, and offers Use this version and Cancel. Using a previous version restores it and records the action — the restore itself becomes a history entry, so it can be undone. If the current file has unsaved edits, Mim saves that state first so it remains recoverable. Cancel, switching tabs, or closing the rail returns to the live file. Binary versions cannot be previewed inline; the rail offers Open copy, which writes a temporary file you can inspect in its native application.

When a file accumulates many saves, the rail keeps the list compact by folding older entries. A toggle at the bottom reads Show older saves with a count of hidden versions.

## Past runs

The History surface in the Navigator collects past chats, app runs, and agent sessions in one chronological list. Active and archived items appear together. Each card shows a label, a preview of its content, a relative date, and metadata such as Archived chat. A search field at the top reads Search conversation history and matches across past chats; app runs and agent sessions are browsable but not searchable.

Opening an archived chat restores the full conversation. App runs keep their event logs and agent sessions keep their scrollback, so you can review what happened. You can also permanently delete any item from the list.

## Managed git sync

By default, Mim does not run git commands against your workspace. The agent has access to tools like `git.status`, `git.diff`, and `git.commit` in chat, but each call goes through the approval gate. Existing git repositories are not silently moved into managed mode.

For Projects that want an automated save-and-sync loop, Mim offers managed sync. In Settings > Project, the Sync section shows two modes:

::: rows
- Manual — Mim reports sync state but does not run git automatically.
- Managed — Mim can commit, pull, and push when you choose Sync now.
:::

The mode and remote are stored in the workspace's `mim.yaml`:

```yaml
sync:
  mode: managed
  remote: git@github.com:org/repo.git
```

With managed mode active and a remote configured, Sync now stages current changes, creates a commit when needed, pulls with fast-forward only when a remote branch exists, and pushes. First pushes set the upstream branch. The settings also show current sync status and any issues. Mim stops on conflicts, missing remotes, or non-fast-forward pulls — it does not auto-resolve conflicts.

## Deleting

Deleting a file from the Files context menu moves it to the OS trash. It is recoverable the same way as any file trashed through Finder or Explorer. The agent can also permanently delete individual files, but directories can only be trashed, not permanently deleted.

File history captures a version before any deletion, so the content is recoverable from the History rail even after the trash is emptied.

::: under-the-hood
Local history lives in `.mim/history/`. `index.json` holds version metadata; `blobs/<prefix>/<sha256>` holds content-addressed file bytes. The default per-file size cap is 5 MB. Files in generated or dependency directories (`.git`, `node_modules`, `dist`, and similar) are excluded, and `.gitignore` and `.mim/historyignore` patterns are honored.

Settings > Project keeps File recovery as the normal control. Advanced shows the total size and version count. History keeps every point for 3 days, then one per day through day 30, then one per week. Delete, rename, and restore boundaries receive 30 days of protection. The 512 MB default soft budget can be changed there; recent recovery points may temporarily exceed it. Optimize history applies the policy immediately and garbage-collects unreferenced content. Clear local history removes all recovery data without touching workspace files.

Managed sync internals and the full tool catalog are documented in [sync tools](/develop/tools).
:::
