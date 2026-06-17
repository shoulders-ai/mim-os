# Document Export (PDF + DOCX)

Markdown documents export to styled PDF and Word files through one shared
pipeline. There are no template presets: the dialog (and the tool params)
expose the layout decisions directly, and both formats consume the same
`DocumentStyle` and citation resolution, so they always agree on structure;
only the final rendering boundary differs.

## Pipeline

```
markdown (file or live editor buffer)
  → citations.ts        resolve [@key] against BibTeX through citeproc/CSL, build bibliography runs
  → documentStyle.ts    DocumentStyle: margins, numbering, justify, columns, page numbers
  ├─ exportHtml.ts      → self-contained HTML → htmlPdf.renderDocumentHtmlToPdf
  │                       (hidden BrowserWindow, printToPDF; Electron only)
  └─ exportDocx.ts      → docx (pure JS) document buffer; works headless
```

## Source

| File | Role |
|---|---|
| `src/main/export/documentStyle.ts` | Single source of truth for the export decisions: `DocumentStyle` (numbering, justify, page-number alignment + skip-first, columns, title-first-H1, uniform cm margins via `uniformMarginsMm`), page sizes (a4, letter, a5), and font families (inter default, lora, zilla). Both renderers derive from `DocumentStyle`; never style one format without the other. |
| `src/main/export/citations.ts` | Tolerant BibTeX parser, CSL-JSON projection, citeproc-backed `[@key]`/`[@a; @b]` resolution, and bibliography as renderer-neutral runs (`{ text, italic }`). Skips code blocks and inline code. Built-in style ids (`apa`, `chicago`, `chicago-author-date`, `ieee`) use core-bundled CSL XML; workspace-relative `.csl` paths are consumed at export time. |
| `src/main/export/exportHtml.ts` | marked → print HTML. Style flags become body classes (`doc--numbered`, `doc--two-col`, …) + CSS variables; all visual styling lives in the single `resources/export-templates/_base.css`. highlight.js code blocks, `<base href>` for relative images, `/`-rooted images resolve against the workspace (live-preview convention), script stripping as defense in depth. |
| `src/main/export/exportDocx.ts` | marked token walker → `docx` objects. Heading numbers computed in code (mirrors the CSS counters exactly; not Word auto-numbering). Footer page numbers (skip-first via a title-page section + empty first-page footer), two-column sections, hanging-indent references, images via injected loader. |
| `src/main/htmlPdf.ts` | `renderDocumentHtmlToPdf(html, options)` — the second caller of the shared hidden-window boundary (slides geometry path is `renderHtmlFileToPdf`). Temp-file load (not data URI) so `<base href>` works; fonts/images readiness wait; 45s timeout. Page numbers via Chromium `displayHeaderFooter` footer template (inline styles + system fonts only). The footer renders on **every** page — Chromium offers no per-page hook, so skip-first-page numbering is DOCX-only. |
| `src/main/tools/export.ts` | `export.pdf`, `export.docx`, `export.styles` tools. `buildDocumentStyle(params)` assembles a `DocumentStyle` from flat params (`numbered_headings`, `justify`, `page_number_position` none/left/center/right, `page_numbers_skip_first`, `margin_cm`, `columns`, `center_first_heading`). Workspace-scoped paths, atomic write (tmp + rename), DOCX image loader (sharp normalizes formats; remote fetch with 8s timeout; reads restricted to the workspace so the tool is not a disclosure channel), font/CSS asset resolution across dev + packaged roots. |
| `src/renderer/components/editor/ExportDialog.vue` | MimDialog of dense `SettingRow` rows. Essential up top (format toggle, page-size and font selects + size); an **Advanced** disclosure holds the rest (margin cm field, page-number position Off/Left/Center/Right + skip-first, numbered-headings and justify `MimToggle`s) and auto-expands when prior settings were customized. Citation row (auto-detects `[@`, suggests a nearby `.bib`) shows only when the doc cites. Save-dialog destination, success state with Open / Reveal. Options persist to `localStorage` (`mim:export-options`). |
| `src/renderer/services/exportOptions.ts` | Pure helpers: `ExportUiOptions` persistence (validates the flat decision set), default output naming, citation detection, `.bib` suggestion. |

## Entry points

- Editor toolbar `Export` button (markdown documents).
- `⇧⌘E` — owned by the native File menu (`Export…`), mirrored by an
  editor-level keydown handler (same duplication pattern as `⌘S`).
- Command palette: `Export document (PDF, Word)`.
- Tools: `export.pdf` / `export.docx` are AI- and package-callable through the
  registry (gate: `write`, path param `output_path`) and work from the
  headless CLI — `mim tool export.docx '{"path":"notes.md"}'`. `export.pdf`
  needs the Electron runtime and reports its unavailability headless.

## Behavior notes

- The dialog always exports the **live buffer** (unsaved edits included);
  `path` is still passed so relative images resolve from the document's
  directory.
- Documents opened from absolute paths outside the workspace export from the
  buffer alone; `path` is still passed for relative-image resolution.
- The save dialog (`allowAbsolutePath: true`) lets users save anywhere on disk.
  AI-callable tools (`export.pdf`, `export.docx`) restrict the output path to
  the workspace for workspace-relative paths; absolute paths are accepted when
  they come from a user-initiated save dialog.
- On success the dialog closes immediately and a toast appears (`Exported
  "name" · N pages` with an **Open** action). Unresolved citations become a
  separate error toast.
- With **Center first heading** on, a leading H1 renders as a centered,
  unnumbered title (`titleFirstH1`); both renderers implement it. (Exposed as a
  tool param `center_first_heading`; not surfaced in the dialog.)
- **Skip first page** for page numbers is DOCX-only: Word omits the number via a
  title-page section, but Chromium's `printToPDF` stamps every page. The dialog
  disables the toggle and says so when PDF is selected.
- DOCX fonts are referenced by name, not embedded — readers without
  Satoshi/Lora/Zilla Slab fall back per the style's declared substitutes.
- Citation keys missing from the `.bib` stay verbatim in the output and are
  reported as an error toast after export.
- `citation_style` accepts the bundled ids (`apa`, `chicago`,
  `chicago-author-date`, `ieee`) or a workspace-relative `.csl` file such as
  `references/styles/nature.csl`.
- Broken/remote-unreachable images degrade to an italic `[alt]` placeholder in
  DOCX; PDF lets Chromium handle them (missing ones render nothing).

## Tests

`citations.test.ts`, `exportHtml.test.ts`, `exportDocx.test.ts` (mammoth reads
the produced .docx back), `tools/export.test.ts` (tool contract incl. headless
parity, traversal, atomic outputs), `services/exportOptions.test.ts`,
`ExportDialog.smoke.test.ts`, plus the File-menu assertions in `menu.test.ts`.
The printToPDF boundary itself is exercised only in the running app — verify
visually after changing `htmlPdf.ts` or `_base.css`.
