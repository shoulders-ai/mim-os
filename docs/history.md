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

The store never writes to the user's `.git` repository and never shells out to
git. `history.clear` and `history.prune` affect only `.mim/history`; they do
not touch workspace files. `history.openVersion` writes a temporary copy under
the OS temp directory so binary/native versions can be opened outside Mim
without restoring them. Text history versions preview inside the editor.

## Capture Model

Capture is best-effort. A history failure must not make a successful file
operation, watcher event, or tool call fail.

Initial coverage comes from `history.baseline`, which scans eligible files and
captures baseline versions. Electron schedules a baseline after boot and after
workspace switch.

Tool-call coverage is wired through the shared tool registry. The registry asks
the history observer for before-snapshots, executes the tool, then persists the
before and after versions. Covered mutations include `fs.write`,
`fs.writeBytes`, `fs.edit`, `fs.create`, `fs.delete`, `fs.trash`, `fs.rename`,
`fs.copy`, `fs.import`, and `documents.importMarkdown`.

External edits are captured from the workspace file watcher through
`history.observeFileChange`. Adds and changes become `external` versions;
unlinks become anchored delete versions.

Restore is also captured. `history.restore` writes a `before-restore` version
for the current state, restores the selected version, then records a `restore`
version. That makes a restore undoable through history.

## Eligibility

History protects product-relevant workspace artifacts under a size cap. The
default per-file cap is 5 MB.

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
- `history.baseline` creates baseline versions for eligible files without
  existing history requirements.

`history.list`, `history.preview`, `history.openVersion`, and `history.stats`
are read tools. `history.restore` is a write tool. `history.prune` and
`history.clear` are settings mutations. `history.baseline` is treated as
read-effect for approvals.

## Display Density

The stored raw history can be noisy, so `history.list` folds versions by default.
The default visible target is 30 versions.

The folding policy keeps:

- the newest version;
- anchored events;
- the latest recent versions;
- one daily anchor for recent days;
- one weekly anchor for older history.

The response includes `totalVersions`, top-level `foldedCount`, and per-version
`foldedCount` metadata. The rail labels this as older saves rather than exposing
the folding model. Callers that need every raw recovery point can pass
`include_folded: true`.

`history.prune` applies the same visibility policy physically. The business
goal is not archival completeness; it is keeping recovery useful when a
workspace has hundreds or thousands of saves. The default rail stays compact,
and destructive thinning is explicit from Settings > Storage.

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

Settings > Storage exposes local recovery health and maintenance:

- storage bytes and version counts from `history.stats`;
- Thin old versions, which calls `history.prune`;
- Clear local history, which calls `history.clear`;
- Sync controls for manual vs managed workspace sync.

The manage surface is deliberately small. Users need confidence that recovery is
available and a safe way to reduce noise; they do not need a second file
manager.
