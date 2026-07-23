# Spec: history & recovery (order 11)

Purpose: nothing in Mim is lost by accident. File recovery, past runs, and managed
git sync.

## Outline

- Open with the promise, stated calmly: edits by you or the agent can be undone.
- File history: every important file has local history under `.mim/` — automatic
  baselines around edits and saves; the Go Back rail in the editor restores a
  version (verify UI: HistoryRail labels, how versions are listed). Independent of
  git; Mim never touches your `.git` on its own.
- Runs history: past chats, app runs, and agent runs are kept and searchable;
  reopen or replay them (verify the history/archive browser labels and what replay
  means for agent runs — persisted scrollback).
- Managed git sync: optional; when a workspace opts in, Mim handles the ordinary
  save/pull/push loop (verify: how opt-in happens, what the user sees). Git tools
  exist in chat too (status/diff/commit) — one sentence.
- Deleting: what delete means where (trash for files — verify `fs` trash behavior).
- Trapdoor: `.mim/history/` layout, baseline pruning policy; sync internals → /develop.

## Boundaries

No trace/audit story (→ privacy & security). No comment threads (→ writing).

## Sources

- docs/history.md
- docs/git.md
- src/renderer/components/editor/HistoryRail.vue
- src/renderer/components/archive/ArchiveBrowser.vue
- src/main/tools/fs.ts (trash/delete semantics)

## Length

800–1200 words.
