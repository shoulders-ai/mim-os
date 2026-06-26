# HTML-to-Markdown Parser

Pure core HTML-to-Markdown conversion lives in `src/main/html/markdown.ts`, with co-located tests in `src/main/html/markdown.test.ts`.

## Scope

The parser accepts already-fetched or already-rendered HTML and returns AI-ready Markdown plus extraction stats. It does not fetch pages, run JavaScript, call Readability, or own browser automation. Current callers:

- `src/main/web/readUrl.ts` runs Readability first, then converts the selected article HTML; selectable PDF URLs bypass this parser and use local PDF text extraction.
- `src/main/web/readWebUrl.ts` is the single web-reading router. It sends selectable PDFs to `readUrl.ts`, normal pages to the stateless rendered reader, and `stateful: true` reads to the Research Browser path after domain-grant enforcement.
- `src/main/web/readRenderedUrl.ts` renders a page in Chromium through `src/main/web/renderedBrowser.ts`, captures visible hydrated DOM via `src/main/web/renderedCapture.ts`, then converts the captured HTML.
- `src/main/web/readResearchUrl.ts` uses the same rendered conversion path through a persistent Research Browser profile.
- `src/main/docx/reader.ts` runs Mammoth first, then converts the generated DOCX HTML for review output.

## Conversion Contract

- HTML parsing uses Domino so the implementation can normalize a DOM instead of applying ad hoc string rewrites.
- Script, style, noscript, metadata, hidden nodes, `aria-hidden` nodes, display-none nodes, and common SPA state code nodes are removed before conversion.
- `data-*` attributes are dropped before Markdown conversion to avoid framework payload noise.
- Link targets are removed by default. Pass `extractLinks: true` to keep Markdown links.
- Base64 `data:image/*` images are dropped.
- Block images are preserved as Markdown images. Images inside `td`, `th`, and heading tags become alt text by default; pass `extractImages: true` to keep their image Markdown. This mirrors the important browser-use extraction behavior around inline image URLs.
- Tables are rendered by Mim before Turndown runs. The table renderer expands `rowspan` and `colspan`, keeps every row rectangular, escapes literal pipes, and merges stacked leading `<th>` rows into descriptive column headers.
- Post-processing removes percent-encoded byte noise, large SPA JSON blobs, blank-only lines, and leading/trailing whitespace.

## Chunking

`chunkMarkdownByStructure()` splits Markdown for AI consumption while respecting semantic blocks:

- headers are preferred split points when the preceding chunk is substantial;
- code fences stay intact;
- tables split only between rows, and continuation chunks carry table headers in `overlapPrefix`;
- list items and indented continuations stay together;
- `startFromChar` returns chunks from the chunk containing that offset.

The chunk size is a soft limit. A single oversized atomic block is allowed rather than being split in the middle.
