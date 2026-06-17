# DOCX Worker Spike — Interim Report (2026-05-13)

## What we set out to answer

Can Mim's AI agents read and annotate real Word manuscripts (.docx) — with citations, comments, tracked changes, tables — without breaking anything?

## What we built

A two-part spike in `spike/docx-worker/`:

### Read side: mammoth.js (8.8MB, pure JS)
- Converts .docx → HTML → clean readable text via `docx-read.mjs`
- Post-processor injects existing comments inline with author/ID: `«[Comment #1 by Dr. Smith: "..."]»`
- Uses mammoth's internal API for comment metadata (author names, IDs)
- Tested on 4 real-world manuscripts (protocols and reports, 324KB–6.3MB)
- Output: ~13.5K words readable text vs 47K tokens of JSON from a custom structured reader

### Write side: C# / .NET 8 / DocumentFormat.OpenXml (109 tests green)
- **Text-match anchoring**: agent quotes text, writer finds it across fragmented XML runs
- `TextSearcher`: concatenates fragmented `<w:r>` elements, handles hyperlinks, field codes, tracked changes
- `DocxWriter` operations:
  - `AddCommentByText(anchorText, author, commentText)` — returns `CommentResult` with `UsedNormalizedMatch` flag
  - `AddCommentReply(parentCommentId, author, replyText)` — properly threaded via w15:commentsEx
  - `ResolveComment(commentId)` — sets done="1"
  - `AddTrackedInsertionByText(anchor, text, "before"|"after"|"replace", author)`
  - `AddTrackedDeletionByText(text, author)` — including text inside existing InsertedRuns
  - `Validate()` — OpenXml schema validation
- Always copies input first, never modifies original
- Naming convention: `_revision_YYYY-MM-DD-HH-mm.docx`

## Key architectural decisions

1. **mammoth.js for reading, not a custom OOXML parser.** A custom structured reader produced 47K tokens of JSON scaffolding for a 5,800-word doc. LLMs need readable text, not typed data models. Mammoth is battle-tested (12 years, 6.2K stars, 4M weekly downloads).

2. **No index passing between read and write.** The LLM reads plain text from mammoth, quotes a text string as anchor, the writer finds it via text search in the XML. Both tools read the same `<w:t>` elements, so the text matches.

3. **OpenXml for writing (not mammoth, not raw XML).** OpenXml gives typed XML constructors that prevent malformed documents. The XML for comments/tracked changes requires precise run splitting that raw string manipulation would get wrong.

4. **pandoc is the fallback.** Already installed (~100MB), handles everything mammoth does plus tracked changes and fldSimple. But mammoth's 8.8MB footprint and pure-JS integration are preferable for the primary path.

## What works

- Reading all 4 real manuscripts without errors
- Adding comments anchored to specific text across fragmented runs
- Adding 50 comments to a single paragraph without ID collisions
- Comment reply threading (including reply-to-reply, depth 10)
- Comment resolution
- Tracked insertions (before/after/replace)
- Tracked deletions (including text inside existing tracked insertions)
- Overlapping and nested comment ranges
- Unicode (German umlauts, em-dashes, smart quotes, XML special chars)
- OpenXml validation passes on all real manuscripts after modifications
- Normalized whitespace fallback for text matching (with warning flag)

## Known gaps and limitations

### Read side (mammoth)
- **fldSimple fields dropped**: "Table :" instead of "Table 1:". Fixable via XML pre-processing.
- **Tracked changes silently accepted**: Shows final text only. Fixable via XML pre-processing or pandoc fallback.
- **Comment anchor range**: Point marker `[1]` only, not which words are highlighted. Sufficient for replying (just needs comment ID).

### Write side (OpenXml)
- **Table cell text not searched** by default (body-level paragraph search only). Separate API needed.
- **Cross-paragraph text search not supported** (by design — text must be within one paragraph).
- **CommentReference ordering**: Appears before CommentRangeEnd in some code paths. Word tolerates it but technically non-compliant. Minor fix needed.
- **6 adversarial tests have weak assertions** — pass but wouldn't catch regressions. Identified by audit agent.

### Not yet built
- Protocol between Mim and the writer (JSON over stdio)
- Integration into Panel tool system
- File duplication with naming convention
- Publishing as self-contained binary for Electron sidecar

## Test summary

| Suite | Tests | Status |
|---|---|---|
| TextSearcherTests | 13 | All green |
| TextMatchWriterTests | 17 | All green |
| RealManuscriptWriteTests | 12 | All green |
| AdversarialTests | 39 | All green |
| DocxReaderTests | 10 | All green (legacy) |
| DocxWriterTests | 8 | All green |
| VerifyOutputXml | 7 | All green (audit) |
| Other | 3 | All green |
| **Total** | **109** | **All green** |

## Bugs found and fixed

1. **CRITICAL (fixed)**: `MarkTextAsDeleted` didn't walk into `InsertedRun` elements → silent no-op when deleting tracked-insertion text.
2. **MEDIUM (fixed)**: `AddCommentByText` silently fell back to normalized matching → now returns `CommentResult.UsedNormalizedMatch` flag.
3. **LOW (fixed)**: `AddCommentReply` threw inconsistent exception type when comments part was missing.

## Recommended next steps

### Immediate (next session)
1. **Fix the 6 weak adversarial test assertions** — tighten `DeepReplyChain`, `ManyComments`, `ValidationAfterMixedOperations`, etc.
2. **Fix CommentReference ordering** — swap two lines in `InsertCommentAnchors`.
3. **Design the JSON-over-stdio protocol** — what the Panel sends, what the writer returns.

### Short-term (integration into Mim)
4. **Publish as self-contained .NET binary** — `dotnet publish -c Release -r osx-arm64 --self-contained` for Electron sidecar.
5. **Wire mammoth reader into Panel tool system** — `docx-read.mjs` logic becomes a tool helper in `src/services/ai/tools/`.
6. **New Panel tool: `review_word_document`** — agent reads via mammoth, reviews, calls writer via subprocess.
7. **File duplication with naming convention** — `original_revision_2026-05-13-03-57.docx`.

### Medium-term (hardening)
8. **fldSimple pre-processor** — expand display text before mammoth sees it.
9. **Tracked changes pre-processor** — inject visible markers for insertions/deletions.
10. **Table cell search** — extend TextSearcher to optionally search inside tables.
11. **Round-trip stability tests** — write → read → write → read, verify no drift.
12. **Add missing adversarial edge cases** — multiple sequential operations fragmenting same paragraph, comment near citation field boundary, concurrent reply threads.

## File structure

```
spike/docx-worker/
├── README.md                   architecture + API reference
├── SPIKE-REPORT.md             this report
├── docx-read.mjs               mammoth reader + comment post-processor
├── test-mammoth.mjs             mammoth evaluation script
├── package.json                 mammoth dependency
├── DocxWorker.sln               .NET solution
├── DocxWorker/                  C# writer project
│   ├── TextSearcher.cs          text search across fragmented runs
│   ├── DocxWriter.cs            text-match write operations + validation
│   ├── DocxReader.cs            legacy structured reader (reference only)
│   ├── Models.cs                data models + CommentResult
│   ├── TestFixtures.cs          synthetic .docx generator (6 fixtures)
│   └── Program.cs               CLI
├── DocxWorker.Tests/            109 xUnit tests
│   ├── TextSearcherTests.cs     13 — search engine
│   ├── TextMatchWriterTests.cs  17 — text-match write ops
│   ├── RealManuscriptWriteTests.cs  12 — real manuscripts
│   ├── AdversarialTests.cs      39 — red-team edge cases
│   ├── VerifyOutputXml.cs       7 — XML output audit
│   ├── DocxReaderTests.cs       10 — legacy reader
│   └── DocxWriterTests.cs       8+1 — index-based ops
├── testdata/                    fixtures + real manuscripts (not tracked)
└── testoutput/                  write test output
```
