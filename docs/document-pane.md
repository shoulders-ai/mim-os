# Document Pane

The Artifact pane's document stage is one tab host for workspace documents. It
is implemented by `src/renderer/components/editor/EditorPanel.vue` and rendered
inside `ArtifactHost.vue`.

## Tab Kinds

`EditorPanel` owns a local `TabState[]` with
`kind: 'text' | 'pdf' | 'table' | 'card'`.

- `text` tabs use one shared CodeMirror view. Markdown, plain text, and code
  files all route here.
- `pdf` tabs embed `PdfArtifact.vue` and point at the workspace file server.
- `table` tabs embed `TableArtifact.vue` for CSV/TSV/TAB files.
- `card` tabs embed `FileCardArtifact.vue` for native or unsupported formats.

PDF and card tabs are path-only views. They never call `fs.read`, never become
dirty, and close without confirmation. Table tabs read the full delimited text
file through `fs.read({ full: true })`, can become dirty through cell edits,
and save explicitly through `fs.write` with `expected_hash`.

When a file or folder is moved from the Files Work surface, open document tabs
whose paths match the old location are retargeted to the new workspace-relative
paths. Text tab buffers, dirty state, and undo state stay in memory; PDF, table,
and card tabs remount against the new path.

## Routing

File open policy is decided before the document pane:

- text-like files open with `EditorPanel.openDocument(path, 'text')`;
- CSV/TSV/TAB files open with `openDocument(path, 'table')`;
- PDFs open with `openDocument(path, 'pdf')`;
- native/unsupported formats open with `openDocument(path, 'card')`;
- absolute paths outside the workspace still open in the OS app.

Text/PDF/table/card opens add or activate a document tab. They do not create separate
Artifact history entries. The pane header history therefore tracks fewer
document transitions; the tab strip owns document switching.

## Text Tabs

Text tabs are the rich text/code editing surface. They own:

- CodeMirror state and per-tab undo history via `view.setState()`;
- per-tab editor scroll snapshots while switching between open text tabs;
- dirty tracking and dirty-count pushes to the main-process quit guard;
- Save/Save As path assignment for untitled documents;
- autosave and external-change conflict handling;
- markdown preview, comments, citations, export, word stats, and current-document
  chat context.

Markdown-specific chrome must stay gated on the active tab being text and
markdown. PDF/table/card tabs should not leak into autosave, comments, export,
current-document context, or text dirty state.

## Implementation Shape

`EditorPanel.vue` is the document-stage orchestrator. It keeps the single shared
CodeMirror view, public `defineExpose` API, and top-level tab/history shell.
Feature-specific state lives in small editor-local modules: file sync/autosave
and conflict handling, inline AI diff review, formatting keymaps/actions,
citation and bibliography resolution, inline comments, keyboard shortcuts,
settings effects, status/dirty-tab labels, table-tab bookkeeping, tab
persistence, shared types, and file metadata helpers.

## Diff Review

One review surface (`DiffReviewBar.vue` + `DiffView.vue`, state in
`stores/diff.ts`) serves three flows, distinguished by `reviewMeta.type`:
`inline-ai` (Cmd+K proposals, editable, Accept/Reject), `approval` (read-only
preview of a pending gate request; the bar's Approve/Decline resolve the same
request as the chat card), and `conflict` (buffer vs disk, labeled `Keep my
version` / `Take disk version` so the discarded side is explicit).

- The bar shows a `+N −N` line delta computed at activation (`services/lineDelta.ts`,
  shared with the approval card summary); it hides past the LCS line cap.
- Keyboard: `Esc` closes, `Mod+Enter` accepts/approves, `Alt+↑/↓` walks chunks.
  The contract is pure in `diffKeyboard.ts`: keys typed into editable surfaces
  outside `[data-diff-scope]` (chat composer, palette) and keys under an open
  dialog are never captured.
- Resolving a chunk via its gutter control auto-advances to the nearest pending
  chunk (`nextChunkIndexFromPos` in `diffPresentation.ts`); draining the last
  chunk announces "All changes resolved" and lets plain `Enter` apply.
- An approval edit whose `old_text` does not match exactly once previews as an
  empty diff with a notice explaining that the edit will fail as written.

## Table Tabs

Table tabs are editable, but deliberately not spreadsheets. They provide a dense
AG Grid Community surface for delimited text files only.

- PapaParse reads the file as arrays, not header-keyed objects, so duplicate and
  blank headers round-trip.
- AG Grid columns use synthetic ids (`c0`, `c1`, ...); row 0 is displayed as the
  header row and preserved during save.
- Data columns are sortable and filterable; a leading source row-number column
  keeps rows identifiable after filtering or sorting.
- Numeric-looking cell values are right-aligned for scanning, but all cell
  values remain strings.
- Serialization keeps the detected delimiter, newline style, trailing newline,
  ragged rows, and rows wider than the header.
- Saves are explicit only. There is no table autosave. Cell edits mark the tab
  dirty immediately; save serializes once and clears dirty without writing if
  the edited table has been reverted to the loaded same-path content.
- Dirty table tabs count toward the main-process quit guard and show the same
  dirty tab/status affordances as text tabs.
- The status bar shows row/column count instead of word/character stats.

## Empty State And Last Close

When the last document tab closes, `EditorPanel` emits `all-tabs-closed`.
`App.vue` responds by setting the Artifact pane state to `rail`.

If the document stage is expanded with no tabs, it shows the explicit empty
state:

- `No document open`
- `New document`
- `Open file...`

No Untitled tab is fabricated on mount, restore failure, or last close. The
`+` tab-strip button, File -> New Document, command palette New document, and
the empty-state button all create a real untitled text tab.

## Lifecycle Invariant

The CodeMirror mount node must stay mounted while the document pane is empty.
The empty state hides the editor body with `v-show`; it must not remove the
editor body with `v-if`.

Reason: `EditorPanel` keeps one CodeMirror `editorView` instance for text tabs.
If the DOM mount point is removed while the view stays alive, later file opens
reuse a detached CodeMirror view and the document appears blank or unfocusable.
The regression test is:

1. create an untitled tab;
2. close the last tab;
3. create another untitled tab and type; and
4. open an existing text file and confirm its content appears.

Keep this invariant in mind when editing the empty state, diff review surface,
or tab body conditional rendering.

## Read-Only Tabs

`EditorPanel.openReadOnlyTab(name, content, sourceId)` opens a text tab with
pre-loaded content and `readOnly: true` on the `TabState`. Read-only tabs:

- skip autosave, dirty tracking, conflict detection, and close confirmation;
- are deduplicated by `readonly:${sourceId}` — opening the same source twice
  activates the existing tab;
- are excluded from `.mim/editor-tabs.json` persistence (they are ephemeral);
- build their CodeMirror state with `{ readOnly: true }` (same path as the
  history preview overlay).

The primary consumer is the package documentation door: clicking the `?` icon
on the Work header (or the Documentation link in Settings > Apps) calls
`package.readme` and opens the result as a read-only tab in the Artifact pane.

## Persistence

Tab state is stored in `.mim/editor-tabs.json` through
`src/renderer/services/editorTabPersistence.ts`.

- Text tabs persist `path`, `name`, `kind`, and only untitled draft content.
- PDF/table/card tabs persist `path`, `name`, and `kind`; they do not persist content.
- Read-only tabs are filtered out entirely; they are never persisted.
- Missing `kind` defaults to `text` for old persisted tab files.
- CodeMirror undo history, selection, and scroll snapshots are runtime-only;
  they are preserved while open tabs are switched, but are not written to disk.

On restore, text tabs re-read disk content. PDF/table/card tabs restore from
path. Table content is loaded by `TableArtifact` when the tab becomes active.

## Test Coverage

Primary tests:

- `EditorPanel.documentTabs.test.ts` covers mixed text/PDF/table/card tabs,
  table save integration, persisted table restore, empty state, close-last
  behavior, and reopening after close-last.
- `EditorTabStrip.test.ts` covers tab kind icons, dirty-dot rules, and
  close-on-single-tab.
- `editorTabPersistence.test.ts` covers serialized `kind` and path-only
  PDF/table/card persistence.
- `TableArtifact.smoke.test.ts` and `tableArtifactModel.test.ts` cover table
  loading, serialization, dirty events, duplicate headers, ragged rows, TSV, and
  newline preservation.
- `ArtifactHost.test.ts` covers forwarding `openDocument` and empty-state
  events.
