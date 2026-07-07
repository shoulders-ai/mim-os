# Spec: writing (order 4)

Purpose: the editor as a writing instrument for research documents. The longest
chapter; it earns it.

## Outline

- The document pane: tabs, autosave, markdown with live preview, formatting toolbar,
  outline. PDFs and tables open here too — one sentence.
- Writing with the agent, three registers:
  - inline AI (<kbd>Cmd+K</kbd>): rewrite or generate in place, review as a diff,
    accept or reject;
  - ghost suggestions: quiet completions as you type (verify how they are accepted —
    key — and where they are toggled);
  - chat-driven edits: the agent edits your file; changes arrive as a reviewable diff
    (diff review bar; accept/reject language — verify labels).
- Comments: inline comments that travel with the file; threads; the review rail;
  sending a comment to chat. (Markdown documents; code-file markers are a trapdoor.)
- Importing: DOCX, PDF, XLSX, BibTeX arrive as markdown via import (user path:
  drag into Files or the import tool — verify).
- Exporting: markdown → PDF and → DOCX. Citations resolve on export — one sentence,
  depth in [references](references).
- Pop-out windows: move a tab to its own window and back.
- Trapdoors: comment tag syntax (`<comment>` tags, `@mim` code markers); export
  pipeline (Chromium print, pure-JS DOCX).

## Boundaries

No citation mechanics (→ references). No code execution, no send-to-terminal
(→ running code). No file history (→ history & recovery).

## Sources

- docs/document-pane.md
- docs/comments.md
- docs/export.md
- src/main/documents/importMarkdown.ts
- src/renderer/services/shortcutLabels.ts (every kbd used)

## Length

1000–1400 words.
