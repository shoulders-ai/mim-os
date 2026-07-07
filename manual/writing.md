---
id: writing
title: writing
order: 4
sources:
  - docs/document-pane.md
  - docs/comments.md
  - docs/export.md
  - src/main/documents/importMarkdown.ts
  - src/renderer/services/shortcutLabels.ts
verified: bf1358ebd68b1348a9fd85c6576c5b71e5f11880
---

# writing

The editor is where research documents live — a tabbed pane for markdown, code,
PDFs, tables, and images, with three distinct ways for the agent to shape your
prose.

## The document pane

Every file opens as a tab. Markdown files are the primary writing surface: they
get a formatting toolbar, live preview, view modes, comments, citations, and
export. PDFs render inline. CSV and TSV files open as editable tables with
sorting and filtering. Images display fit-to-pane with a click to toggle full
size. Formats Mim cannot render natively open as a file card.

Markdown tabs autosave one second after you stop typing. <kbd>Cmd+S</kbd> saves
immediately; <kbd>Shift+Cmd+S</kbd> saves to a new path. Table tabs save only on
explicit <kbd>Cmd+S</kbd>.

The formatting toolbar sits above every markdown document. It offers heading
levels, bold, italic, strikethrough, bullet and numbered lists, checkboxes,
blockquotes, horizontal rules, links, images, inline code, and citations. The
toolbar also holds Comment. At the right edge: Export and — for R Markdown or
Quarto files, when Quarto or R is installed — Render.

Three view modes control how markdown is displayed. The status bar shows a
segmented control; <kbd>Cmd+E</kbd> cycles through them:

::: rows
- Source — the editor with live preview enabled by default, rendering markdown
  formatting inline and revealing syntax at the cursor. Toggled in Settings under
  Appearance.
- Split — editor and rendered preview side by side.
- Preview — full rendered output, no editor.
:::

## Writing with the agent

Mim offers three registers of AI-assisted writing, each at a different distance
from your text.

**Inline rewrite.** Select text (or place your cursor for a free-form generation)
and press <kbd>Cmd+K</kbd>. A floating dialog appears anchored to the selection.
Type an instruction — rewrite, compress, translate — and press <kbd>Enter</kbd>.
The agent rewrites the selection and the result appears as an inline diff with a
line delta showing additions and deletions. The review bar labels the change
AI edit with Accept and Reject buttons. <kbd>Cmd+Enter</kbd> accepts;
<kbd>Esc</kbd> rejects and closes the review.

**Ghost suggestions.** Type `++` quickly in a document — not directly after a
word. The two characters are consumed
and the agent generates a continuation from the surrounding context. Ghost text
appears in muted type ahead of your cursor.

- <kbd>Tab</kbd> accepts the full suggestion.
- <kbd>Option+→</kbd> accepts the next word only.
- <kbd>Up</kbd> / <kbd>Down</kbd> cycles between alternatives when more than one
  is returned.
- <kbd>Esc</kbd> dismisses the ghost.

The model used for ghost suggestions is configured in Settings under AI.

**Chat-driven edits.** When you ask the agent in chat to edit a document, the
change arrives as a reviewable diff. The review bar shows Approve and Decline
buttons. <kbd>Cmd+Enter</kbd> approves; <kbd>Esc</kbd> closes the review.
<kbd>Option+↑</kbd> and <kbd>Option+↓</kbd> walk between changed chunks.
Resolving a chunk via its gutter control advances to the next pending chunk
automatically.

## Comments

Inline comments travel with the file. Select text in a markdown document and
press <kbd>Shift+Cmd+M</kbd> to start a comment. You, the agent, and connected
CLI agents can reply, building a thread anchored to the selected passage.

The review rail opens on the right side of the editor. When collapsed, a count
in the status bar shows how many threads exist; clicking it or pressing
<kbd>Shift+Cmd+M</kbd> with no selection reopens the rail. The rail header shows
navigation arrows to step through threads in document order.

Individual notes can be edited in place and replies deleted. Each thread has an
Apply as edit action that asks the inline AI to address the comment; the
proposed change opens the same diff review flow, and accepting it resolves the
comment in one step.

Comments can be resolved individually or all at once with Resolve all at the
bottom of the rail. Every resolve is recoverable from [file history](history-recovery).

Send to chat stages the full document and its threads as a chat draft; nothing
goes to the agent until you send it. When a
document has no comments, the rail offers Request AI review — the agent reads the
document and leaves its own comments.

::: under-the-hood
Markdown documents store comments as `<comment>` pseudo-HTML tags inline in the
file. Code files use `@mim` whole-line markers in the file's own comment syntax.
Both formats are hidden by editor decorations; markdown tags are additionally
stripped before export. Raw
markup is visible in git diffs and external editors by design.
:::

## Importing

Drag a file from your system into Files to bring it into the workspace.
The agent can then convert DOCX, XLSX, XLSM, BibTeX (`.bib`), and selectable PDF
files into markdown with the `documents.importMarkdown` tool. Converted documents
are written to `imports/` by default, with extracted images saved alongside them.
Scanned or image-only PDFs are refused; legacy `.doc` and `.xls` formats must be
resaved as `.docx` or `.xlsx` first.

## Exporting

Press <kbd>Shift+Cmd+E</kbd> or click Export in the toolbar to open the export
dialog. Choose between PDF and Word, then set page size, font, and — under the
Advanced section — margins, page-number position, numbered headings, and
justified text.

If the document contains `[@key]` citations, the dialog detects them and shows a
bibliography file and citation style selector. Citations resolve during export;
depth is in [references](references).

Both formats export the live editor buffer, including unsaved edits. On success a
toast confirms the export — with a page count for PDF — and offers to open the
file. The agent can export without opening the dialog through the `export.pdf`
and `export.docx` tools.

::: note
Skip-first-page numbering is available in DOCX only. PDF export stamps a page
number on every page.
:::

::: under-the-hood
PDF export renders self-contained HTML through a hidden Chromium window
(`printToPDF`). DOCX export builds the document in pure JavaScript — no Word
installation required. Both renderers derive layout from the same
`DocumentStyle`, so structure always agrees between formats.
:::

## Pop-out windows

Click the pop-out button in the tab bar or run Move Tab to New Window from the
command palette. The tab moves — not copies — with its full state into its own
OS window: content, selection, scroll position, view mode, and dirty flag all
transfer. To return it, use the same button in the pop-out. A dirty pop-out
prompts before closing. Pop-out windows are not restored on restart.
