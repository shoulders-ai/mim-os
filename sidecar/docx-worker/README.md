# DOCX Worker Spike

Mim sub-project: let AI agents read and annotate Word manuscripts (.docx).

## Architecture

```
mammoth.js reads .docx → clean text for LLM
LLM reads text, quotes an anchor string
OpenXml writer finds anchor in .docx by text search → inserts comment/tracked change
Output: copy of original with modifications, original untouched
```

- **Read**: mammoth.js (8.8MB, pure JS, MIT) converts .docx → HTML → clean text. Post-processor injects comment metadata (author, text, ID) inline.
- **Write**: C# / .NET 8 / DocumentFormat.OpenXml 3.5.1. Text-match anchoring — agent quotes text, writer finds it across fragmented runs, resolves to paragraph + offsets internally.
- **No index passing between read and write.** The text itself is the anchor.

## Read side — mammoth.js vs pandoc

Tested on 4 real-world manuscripts (protocols and reports, 324KB–6.3MB).

| | mammoth.js | pandoc |
|---|---|---|
| Size | 8.8MB npm | ~100MB binary |
| Integration | JS import | subprocess |
| Headings (German locales) | ✅ maps by style *name* | ✅ |
| Tables | ✅ | ✅ |
| Comments (anchor + author + text) | ✅ with post-processing | ✅ native spans |
| Comment anchor range (which words) | ❌ point marker only | ✅ start/end spans |
| Tracked changes | ❌ silently accepts | ✅ `--track-changes=all` |
| fldSimple (Table 1:, Figure 1:) | ❌ drops numbering | ✅ |
| Footnotes | ✅ | ✅ |
| References/bibliography | ✅ | ✅ |
| Figure captions | ✅ text, no number | ✅ full |
| Images | detectable | ✅ referenced |
| Speed (6.3MB file) | ~2s | ~1.1s |

**Decision**: mammoth.js for now. Two known gaps (fldSimple, tracked changes) are fixable via XML pre-processing without forking mammoth. Pandoc is the fallback if we hit something mammoth truly can't handle.

## Write side — OpenXml (.NET)

62/62 tests passing. Tested against all 4 real-world manuscripts.

### Agent-facing API (text-match anchoring)

| Method | What it does |
|---|---|
| `AddCommentByText(anchorText, author, commentText)` | Find text across fragmented runs, anchor comment on it |
| `AddCommentByText(..., occurrenceIndex)` | Target Nth occurrence when text appears multiple times |
| `AddCommentReply(parentCommentId, author, replyText)` | Threaded reply via w15:commentsEx |
| `ResolveComment(commentId)` | Set done="1" in commentsExtended |
| `AddTrackedInsertionByText(anchor, text, "before"\|"after"\|"replace", author)` | Tracked insertion at anchor position |
| `AddTrackedDeletionByText(text, author)` | Tracked deletion of matched text |
| `Validate()` | OpenXml schema validation, catches XML corruption |

### Internal plumbing (index-based, used by text-match layer)

| Method | What it does |
|---|---|
| `AddComment(paragraphIndex, startOffset, endOffset, ...)` | Low-level comment insertion with run splitting |
| `TextSearcher.FindText(body, searchText)` | Concatenates fragmented runs, finds match, returns paragraph + offsets |
| `TextSearcher.FindTextNormalized(body, searchText)` | Same but with whitespace normalization |
| `TextSearcher.GetParagraphPlainText(para)` | Handles: fragmented runs, hyperlinks, field codes, tracked changes |

### How OpenXml works (conceptual model)

A .docx is a ZIP of XML files. The main ones:

- `word/document.xml` — paragraphs, runs (text fragments), tables, comment markers
- `word/comments.xml` — comment text, author, date (linked by ID)
- `word/commentsExtended.xml` — reply threading (paraId → paraIdParent)

OpenXml is a **typed XML DOM**, not a document editing API. No `addComment()` — you manually construct XML nodes and insert them. Text is fragmented across multiple `<w:r>` (run) elements due to spell-check, formatting changes, tracked changes, etc.

To add a comment: (1) create Comment element in comments.xml, (2) find target text across fragmented runs, (3) split runs at match boundaries, (4) insert CommentRangeStart/End/Reference markers. Our TextSearcher + DocxWriter handles all of this.

### Test coverage

- **TextSearcherTests** (13): fragmented runs, hyperlinks, field codes, tracked changes, normalized whitespace, multiple occurrences
- **TextMatchWriterTests** (17): comment by text, cross-run anchoring, multiple comments, table cells, near citations, reply threading, reply-to-reply, resolve, tracked insert/delete/replace, validation
- **RealManuscriptWriteTests** (12): add comment on known text in each real manuscript, preserve content, validate, comment near tables
- **DocxReaderTests** (10): paragraph/table/comment/citation extraction (legacy reader, kept for reference)
- **DocxWriterTests** (8): index-based operations, round-trip preservation, fragmented run test

## Key findings

1. **Custom OOXML reader was the wrong approach.** 47K tokens of JSON scaffolding for a 5,800-word doc. LLMs need readable text, not typed data models. Mammoth produces 13.5K words of readable text for the same doc.
2. **Text-match anchoring works.** The agent quotes text from mammoth's output, the writer finds it in the XML. Both read the same `<w:t>` elements, so the text matches. No index passing needed.
3. **Real manuscripts fragment text heavily.** A single sentence can be 10+ `<w:r>` elements. The TextSearcher concatenates them and maps matches back to run boundaries.
4. **Comment reply threading requires commentsExtended.** Without w15:commentsEx entries, Word shows replies as orphan comments. Our writer generates proper paraId → paraIdParent mappings.
5. **German-locale heading styles** (`berschrift1` etc.) broke our custom reader but mammoth handles them by resolving style *names* not IDs.
6. **All 4 real manuscripts validate cleanly** after adding comments — zero OpenXml validation errors.

## File structure

```
spike/docx-worker/
├── docx-read.mjs              mammoth reader + comment post-processor
├── test-mammoth.mjs            mammoth raw evaluation script
├── DocxWorker/                 C# writer project
│   ├── TextSearcher.cs         text search across fragmented runs
│   ├── DocxWriter.cs           text-match write operations + validation
│   ├── DocxReader.cs           legacy structured reader (superseded by mammoth)
│   ├── Models.cs               data models + operation types
│   ├── TestFixtures.cs         synthetic .docx generator (6 fixtures)
│   └── Program.cs              CLI (read, add-comment-text, reply, validate)
├── DocxWorker.Tests/
│   ├── TextSearcherTests.cs    13 tests — text search engine
│   ├── TextMatchWriterTests.cs 17 tests — text-match write operations
│   ├── RealManuscriptWriteTests.cs  12 tests — real manuscript operations
│   ├── DocxReaderTests.cs      10 tests — legacy reader
│   └── DocxWriterTests.cs      8 tests — index-based operations
├── testdata/                   synthetic fixtures + 4 real manuscripts
└── testoutput/                 writer test output
```

## Commands

```bash
# Read (mammoth)
node docx-read.mjs "testdata/somefile.docx"

# Write (OpenXml)
export DOTNET_ROOT="/opt/homebrew/opt/dotnet@8/libexec" && export PATH="$DOTNET_ROOT:$PATH"
dotnet test                                          # 62 tests
dotnet run --project DocxWorker -- add-comment-text input.docx output.docx "anchor text" "Author" "Comment"
dotnet run --project DocxWorker -- reply input.docx output.docx 1 "Author" "Reply text"
dotnet run --project DocxWorker -- validate output.docx

# Generate synthetic fixtures
dotnet run --project DocxWorker -- generate-fixtures testdata
```
