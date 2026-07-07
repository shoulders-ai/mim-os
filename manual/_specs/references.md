# Spec: references (order 6)

Purpose: citations and bibliography — from a BibTeX file to a cited, exported
document.

## Outline

- The model: your bibliography is a file in the workspace (BibTeX). Mim resolves
  citations in documents against it. State where the bibliography is expected /
  how it is found (verify in references source — do not guess).
- Citing while writing: citation syntax in markdown, editor support (completion,
  hover, health indicators — verify what actually ships in the citations CodeMirror
  extension and `citationHealth.ts`).
- Citation health: unresolved or duplicate keys are surfaced (verify exact behavior).
- Export: citations render through citeproc on PDF/DOCX export; styles (verify which
  CSL handling exists).
- Importing references: BibTeX import; the References app (from the app catalog)
  captures DOIs and PDFs into a managed library — one paragraph, marked as an app,
  link [apps](apps).
- Trapdoor: citeproc pipeline, `references.*` tools.

## Boundaries

No general export mechanics (→ writing). No literature search (→ web research
covers search; Scholar app → apps).

## Sources

- src/main/tools/references.ts
- src/main/export/citations.ts
- src/renderer/services/citationHealth.ts
- src/renderer/components/editor/codemirror/ (citations extension)
- docs/export.md

## Length

700–1100 words.
