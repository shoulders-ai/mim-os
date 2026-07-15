# Local File History

Local file history is Mim's per-file recovery layer. It is not the conversation
History Work surface, not git, and not managed sync. Its job is to make
workspace file changes recoverable when a user, agent, package, or external app
changes an important artifact.

## Source Map

- Store and policy: `src/main/history/history.ts`
- Tool registration: `src/main/tools/history.ts`
- Tool observer hook: `src/main/tools/registry.ts`
- Electron wiring: `src/main/index.ts`
- Headless wiring: `src/main/headless.ts`
- Permission policy: `src/main/security/gate.ts`
- Artifact rail: `src/renderer/components/editor/HistoryRail.vue`
- Document host wiring: `src/renderer/components/editor/EditorPanel.vue`
- Files context entry: `src/renderer/components/files/FilesContextMenu.vue`
- Manage surface: `src/renderer/components/settings/StorageSettingsPanel.vue`
- Tests: `src/main/history/history.test.ts`, `src/main/tools/history.test.ts`,
  `src/renderer/components/editor/HistoryRail.test.ts`,
  `src/renderer/components/editor/EditorPanel.save.test.ts`

## Storage

History lives under the workspace runtime directory:

- `.mim/history/index.json` stores version metadata.
- `.mim/history/blobs/<prefix>/<sha256>` stores content-addressed file bytes.
- `.mim/history/baseline-state.json` stores progress only while a bounded
  baseline scan has more files to visit.

The store never writes to the user's `.git` repository and never shells out to
git. `history.clear` and `history.prune` affect only `.mim/history`; they do
not touch workspace files. `history.openVersion` writes a temporary copy under
the OS temp directory so binary/native versions can be opened outside Mim
without restoring them. Text history versions preview inside the editor.

## Capture Model

Capture is best-effort. A history failure must not make a successful file
operation, watcher event, or tool call fail.

File recovery is enabled by default through the workspace `historyEnabled`
setting. Turning it off stops every new baseline, watcher, restore-boundary,
and tool-mediated capture. Existing versions remain readable, previewable, and
restorable until the user clears them; restoring while capture is off does not
create another recovery point. Turning recovery back on resumes capture without
requiring a restart.

Initial coverage comes from `history.baseline`, but baselines are deliberately
narrow: authored text such as Markdown, prose, code, bibliographies, and config
files only. Tables, JSON streams, PDFs, Office files, images, and other binary or
bulk data are not baselined. Baseline files default to at most 512 KB and the
store admits at most 64 MB of unique baseline content. This preserves the
pre-change state when an external editor overwrites a closed text file without
turning a downloaded dataset into recovery storage.

Electron schedules delayed, bounded baseline batches after boot and workspace
switch. Directory traversal is stable and resumable: a truncated batch writes a
cursor and the next batch continues after it instead of rescanning the same
prefix. `truncated` means the batch hit a scan, capture, time, or storage limit.

Tool-call coverage is wired through the shared tool registry. Before an
existing eligible file is overwritten, edited, deleted, renamed, or replaced by
`documents.importMarkdown`, the registry captures its current state. Successful
overwrites and edits then capture the new state. The full 5 MB eligibility cap
applies here, including data and binary formats: a Mim-mediated destructive
mutation is valuable recovery evidence even when the file was not eligible for
a broad baseline. Creating, copying, or importing a new path does not create a
one-version history because there is no prior state to recover.

External edits are captured from the scoped workspace watcher for files that
the editor explicitly registers, usually open writable text tabs. Authored-text
changes become ordinary `external` versions and unlinks become destructive
delete versions. Adds are ignored, as are binary/data change events. Bulk
changes to unopened files are intentionally not watched recursively; their
pre-overwrite protection comes from the earlier authored-text baseline.

Restore is also captured. `history.restore` writes a `before-restore` version
for the current state, restores the selected version, then records a `restore`
version. That makes a restore undoable through history.

## Eligibility

History protects product-relevant workspace artifacts under a size cap. The
default per-file cap for targeted mutation recovery is 5 MB. Automatic
baselines use the narrower authored-text and 512 KB limits described above.

Eligible paths are decided by `isHistoryEligiblePath`:

- common research, document, data, code, and config extensions are included;
- `README`, `README.md`, `AGENTS.md`, and `CLAUDE.md` are included by basename;
- generated/runtime/dependency segments are skipped, including `.git`, `.mim`,
  `node_modules`, `dist`, `build`, `out`, `.cache`, Python virtualenvs, and
  similar build/cache folders.

The store also honors simple ignore patterns from `.gitignore` and
`.mim/historyignore`. Negated patterns are ignored for now.

## Tools

- `history.list { path, include_folded? }` returns the current file state and
  versions for one file.
- `history.preview { path, version_id }` returns text content for text versions
  and metadata for binary/deleted versions.
- `history.openVersion { path, version_id }` writes the selected version to a
  temporary file and returns the native-openable path. The renderer uses this
  for binary/native formats, not for text history preview.
- `history.restore { path, version_id }` restores a version and captures the
  restore action.
- `history.stats` reports history directory bytes, blob bytes, protected file
  count, version count, and prunable folded-version count.
- `history.prune` physically removes folded versions according to the current
  visibility policy and garbage-collects unreferenced blobs.
- `history.clear` clears local recovery storage for the current workspace.
- `history.baseline` creates authored-text baseline versions without existing
  history requirements. Bounded callers can pass scan, capture, or time limits
  and should check the `truncated` flag; later calls resume a truncated scan.

`history.list`, `history.preview`, `history.openVersion`, and `history.stats`
are read tools. `history.restore` is a write tool. `history.prune` and
`history.clear` are settings mutations. `history.baseline` is treated as
read-effect for approvals.

## Retention And Display Density

Retention is automatic on every successful capture and baseline batch. It uses
the existing folding ladder as the physical storage policy:

- keep every recovery point for the newest 3 days;
- then keep one point per UTC day through day 30;
- then keep one point per week;
- protect delete, rename, and restore boundaries for 30 days;
- always keep the newest point for each path.

Ordinary `anchor` metadata does not make a version immortal. Only recent
destructive boundaries get elevated protection. The store also has a 512 MB
soft content budget. After time compaction it evicts the oldest unprotected
points until the budget is met; exact recent points, recent destructive points,
and each path's newest point can make the soft limit overflow.

`history.list` also folds its response for a compact rail. The default visible
target is 30 versions and follows the same daily/weekly priorities.

The folding policy keeps:

- the newest version;
- recent destructive events;
- the latest recent versions;
- one daily anchor for recent days;
- one weekly anchor for older history.

The response includes `totalVersions`, top-level `foldedCount`, and per-version
`foldedCount` metadata. The rail labels this as older saves rather than exposing
the folding model. Callers that need every raw recovery point can pass
`include_folded: true`.

`history.prune` applies retention and the byte budget immediately, garbage
collects unreferenced content, and removes legacy singleton external-add
versions when the live file still exists. The business goal is useful recovery,
not archival completeness.

## Go Back Surface

The recovery UX is file-first:

- the active document tab shows a History control when it has a workspace path;
- Files Work exposes Version history from the row context menu;
- the rail shows the current file plus a folded, newest-first list of previous
  saves, with relative time as the primary label;
- text versions do not expand inside the rail. Clicking one previews that
  version read-only in the main editor, with a clear previous-save banner;
- the preview banner offers Use this version and Cancel. Cancel, the current
  row, tab changes, and rail close return to the live current file;
- line-change counts stay as compact `+` / `-` metadata in the rail and banner.
  The rail does not show inline diff snippets;
- using a previous version calls `history.restore`; if the current buffer has
  unsaved edits, Mim saves that current state first so it remains recoverable;
- binary/native versions can be opened as temporary copies;
- restore reloads the active artifact so the user sees the recovered state.

This is not the Navigator conversation History surface, and it is not a git UI.

## Manage Surface

Settings > Workspace keeps the normal recovery surface to one **File recovery**
toggle. The technical controls are closed by default under **Advanced**:

- storage bytes and version counts from `history.stats`;
- a configurable 256 MB-2 GB soft history budget (512 MB default);
- Optimize history, which calls `history.prune` immediately;
- Clear local history, which calls `history.clear`;
- a separate **Local audit trail** toggle plus audit/content storage controls;
- Sync controls for manual vs managed workspace sync.

Turning File recovery off asks for confirmation because future changes will no
longer gain recovery points. It does not silently delete the versions the user
already has; Clear local history remains an explicit Advanced action.
