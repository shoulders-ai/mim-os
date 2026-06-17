# Proposal: Side-by-side document editing

**Status:** Proposal (no implementation)
**Context:** plan-editor-fitness.md section 3

## Problem

The editor displays one document at a time. Reviewing and comparing documents (a stated core workflow) requires switching tabs. There is no way to view two documents simultaneously.

## Options

### A. Split Artifact pane

Split the existing Artifact pane into two editor containers. The user activates split mode (via toolbar or keyboard shortcut), then opens a second file that renders in the right half.

**Advantages:**
- Contained within the current pane architecture; no new window management.
- Familiar (VS Code, JetBrains). Low conceptual overhead.
- Both documents share the same theme, font, and editor settings automatically.

**Disadvantages:**
- The Artifact pane already hosts editor, diff view, PDF viewer, file cards, and package UIs. Adding split state to the pane router increases complexity.
- EditorPanel currently owns a single `editorView`. A split requires either a second EditorView instance inside the same component or extracting the editor core into a reusable sub-component.
- Nested tab state: each half needs its own tab strip, active tab, and undo history. The current single-`tabs` reactive array becomes two.
- Interaction questions: which half gets focus for Cmd+S, Cmd+K, ghost? Which half does the chat `Current document` chip read?

**Implementation cost:** Medium-high. Refactor EditorPanel to host two independent editor instances, add split state management, update the Artifact pane router, and resolve the current-document ambiguity.

### B. Second window (BrowserWindow)

Open a second Electron BrowserWindow for the comparison document. Each window is independent and fully functional.

**Advantages:**
- Zero changes to the existing single-pane architecture.
- Native OS window management (resize, drag to second monitor, snap).
- Clear ownership: each window has its own EditorPanel, undo history, tabs.

**Disadvantages:**
- Electron multi-window adds complexity: IPC state sync, shared Pinia stores across windows, workspace-file-change events must reach all windows.
- Two windows editing the same file need conflict detection (already partially solved by the hash-based stale-write guard, but the in-memory conflict bar only exists in the originating window).
- Ghost suggestions, inline AI, and model controls need to work per-window.
- Users lose the spatial relationship between the two documents.

**Implementation cost:** High. Requires multi-window IPC, per-window store hydration, and cross-window conflict management.

### C. Reuse DiffView for arbitrary file pairs

The existing `DiffView.vue` and `DiffReviewBar.vue` already render two documents side-by-side in a unified or split diff layout. Extend this to support arbitrary file comparison, not just edit review.

**Advantages:**
- Most of the rendering infrastructure exists. DiffView already handles two-document display with syntax highlighting.
- Read-only comparison is the most common use case ("compare these two files"), and DiffView is already read-only.
- Minimal new state: just source and target paths, no second tab strip.

**Disadvantages:**
- DiffView is built for reviewing a single proposed change (original vs modified of the same file). Using it for two unrelated files requires removing the diff-chunk navigation, accept/reject, and "resolved content" concepts.
- No editing: the user can see differences but cannot modify either side.
- Does not solve the general "work on two documents at once" need.

**Implementation cost:** Low-medium. Add a "Compare files" entry point (e.g. from the Files context menu) that populates the diff store with two file reads. Minimal new UI.

## Recommendation

**Start with Option C** (diff-based comparison) and **plan for Option A** (split pane) as the eventual full solution.

Reasoning:
1. The immediate user need is reviewing and comparing, not simultaneous editing. A comparison view (Option C) ships in days and serves the core workflow.
2. Option A is the right long-term answer but requires a significant EditorPanel refactor that should be designed alongside the broader workbench rewrite (see `docs/workbench-implementation-plan.md`).
3. Option B (second window) is architecturally expensive and solves a less common use case (editing two files at once on separate monitors).

Concrete next steps for Option C:
- Add a "Compare with..." action to the Files context menu.
- Open DiffView with two arbitrary file reads (no review bar accept/reject).
- Add a keybinding (e.g. Cmd+Shift+D) to compare the active editor tab with a file picker.
