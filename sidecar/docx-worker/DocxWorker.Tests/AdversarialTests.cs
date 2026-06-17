using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentFormat.OpenXml.Validation;
using DocxWorker;

namespace DocxWorker.Tests;

/// <summary>
/// Adversarial / edge-case tests designed to break TextSearcher and DocxWriter.
/// Tests marked with "// BUG:" reveal real defects.
/// Tests marked with "// LIMITATION:" reveal acceptable design boundaries.
/// </summary>
public class AdversarialTests : IDisposable
{
    private readonly string _outputDir;
    private readonly DocxWriter _writer = new();
    private readonly DocxReader _reader = new();
    private readonly TextSearcher _searcher = new();

    public AdversarialTests()
    {
        _outputDir = Path.Combine(Path.GetTempPath(), "docxworker-adversarial-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_outputDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_outputDir))
            Directory.Delete(_outputDir, recursive: true);
    }

    // ========================================================================
    // Helper: create a minimal .docx programmatically
    // ========================================================================

    private string CreateDocx(string name, params string[] paragraphs)
    {
        var path = Path.Combine(_outputDir, name);
        using var doc = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;
        foreach (var text in paragraphs)
        {
            body.Append(new Paragraph(new Run(new Text(text) { Space = SpaceProcessingModeValues.Preserve })));
        }
        return path;
    }

    private string CreateDocxWithBody(string name, Action<Body> configure)
    {
        var path = Path.Combine(_outputDir, name);
        using var doc = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        configure(mainPart.Document.Body!);
        return path;
    }

    private string OutputPath(string name) => Path.Combine(_outputDir, name);

    // ========================================================================
    // 1. Empty string search
    // ========================================================================

    [Fact]
    public void EmptyStringSearch_AddCommentByText_ShouldThrowNotCorrupt()
    {
        // TextSearcher.FindText returns null for empty string, so this should throw.
        var input = CreateDocx("empty-search.docx", "Some normal text.");
        var output = OutputPath("empty-search-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var ex = Assert.Throws<ArgumentException>(() =>
                session.AddCommentByText("", "Author", "Comment on nothing"));
            Assert.Contains("not found", ex.Message, StringComparison.OrdinalIgnoreCase);
        }
    }

    // ========================================================================
    // 2. Search text spanning a paragraph boundary
    // ========================================================================

    [Fact]
    public void CrossParagraphSearch_ShouldNotMatchAcrossBoundary()
    {
        // LIMITATION: TextSearcher works per-paragraph. Text that spans two
        // paragraphs will never be found. This is by design.
        var input = CreateDocx("cross-para.docx",
            "This is the end",
            "Start of next paragraph");
        var output = OutputPath("cross-para-out.docx");

        using (var session = _writer.Open(input, output))
        {
            Assert.Throws<ArgumentException>(() =>
                session.AddCommentByText("end\nStart", "Author", "Spans paragraphs"));
        }
    }

    [Fact]
    public void CrossParagraphSearch_ConcatenatedWords_ShouldNotMatch()
    {
        // LIMITATION: last word of para1 + first word of para2 won't match
        var input = CreateDocx("cross-para2.docx",
            "The patient received treatment",
            "outcomes were measured weekly");
        var output = OutputPath("cross-para2-out.docx");

        using (var session = _writer.Open(input, output))
        {
            Assert.Throws<ArgumentException>(() =>
                session.AddCommentByText("treatment outcomes", "Author", "Cross boundary"));
        }
    }

    // ========================================================================
    // 3. Unicode / special characters
    // ========================================================================

    [Fact]
    public void Unicode_GermanCharacters_ShouldFindAndAnchor()
    {
        var input = CreateDocx("unicode-german.docx",
            "Die Lebensqualität der Patienten wurde über 12 Monate gemessen.");
        var output = OutputPath("unicode-german-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("Lebensqualität", "Dr. Müller", "Check spelling");
            session.Save();
            Assert.NotNull(commentId);
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal("Lebensqualität", content.Comments[0].AnchorText);
    }

    [Fact]
    public void Unicode_EmDashAndSmartQuotes_ShouldFindAndAnchor()
    {
        // Em-dashes and smart quotes are common in clinical manuscripts
        var input = CreateDocx("unicode-emdash.docx",
            "The treatment — a novel approach — showed “significant” improvement.");
        var output = OutputPath("unicode-emdash-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("— a novel approach —", "Author", "Rephrase");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Contains("novel approach", content.Comments[0].AnchorText);
    }

    [Fact]
    public void Unicode_NonBreakingSpace_ExactMatchBehavior()
    {
        // LIMITATION: Non-breaking space (U+00A0) is a different character from regular space (U+0020).
        // TextSearcher uses StringComparison.Ordinal, so "100 mg" (regular space) will NOT match
        // "100 mg" (NBSP). This is correct ordinal behavior.
        // However, the normalized search (FindTextNormalized) treats NBSP as whitespace and
        // WILL match. AddCommentByText falls back to normalized search, so it actually succeeds.
        var input = CreateDocx("unicode-nbsp.docx",
            "100 mg was administered daily.");
        var output = OutputPath("unicode-nbsp-out.docx");

        using (var session = _writer.Open(input, output))
        {
            // The exact search fails but normalized fallback finds it.
            // This test documents the actual behavior: it does NOT throw.
            // BUG: This could be surprising — callers searching for "100 mg" match "100 mg"
            // via the silent normalized fallback, which changes the offsets. The returned anchor
            // might have different whitespace than expected.
            var commentId = session.AddCommentByText("100 mg", "Author", "Check dose");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
    }

    // ========================================================================
    // 4. Very long anchor text (entire paragraph)
    // ========================================================================

    [Fact]
    public void LongAnchor_EntireParagraph_ShouldWork()
    {
        var longText = "This is a very long paragraph that serves as the anchor text for a comment. " +
                       "It contains multiple sentences and should be handled correctly by the text searcher. " +
                       "The entire paragraph is used as the anchor, which is an edge case that tests the " +
                       "maximum anchor length the system can handle without corrupting the document structure.";
        var input = CreateDocx("long-anchor.docx", longText);
        var output = OutputPath("long-anchor-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText(longText, "Author", "Comment on entire paragraph");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal(longText, content.Comments[0].AnchorText);
    }

    // ========================================================================
    // 5. Anchor text that appears inside a comment (should not match comment XML)
    // ========================================================================

    [Fact]
    public void AnchorText_SameAsExistingCommentText_ShouldNotMatchCommentContent()
    {
        var input = CreateDocx("comment-text-match.docx",
            "The gold standard for treatment is well established.");
        var output = OutputPath("comment-text-match-out.docx");

        using (var session = _writer.Open(input, output))
        {
            // First comment says "gold standard" in its comment text
            var id1 = session.AddCommentByText("well established", "Dr. A", "gold standard");
            // Second comment searches for "gold standard" — must match body, not comment
            var id2 = session.AddCommentByText("gold standard", "Dr. B", "Needs citation");
            session.Save();
        }

        var content = _reader.Read(output);
        var allComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(2, allComments);
    }

    // ========================================================================
    // 6. Anchor text is a substring of multiple words
    // ========================================================================

    [Fact]
    public void SubstringMatch_ShortAnchor_MatchesFirstOccurrence()
    {
        // "at" appears inside "that", "patients", "treatment" — should match first occurrence
        var input = CreateDocx("substring.docx",
            "We found that patients receiving treatment showed improvement at follow-up.");
        var output = OutputPath("substring-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("at", "Author", "Ambiguous match");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        // "at" first appears inside "that" at offset 9
        Assert.Equal("at", content.Comments[0].AnchorText);
    }

    // ========================================================================
    // 7. Anchor text with XML-special characters
    // ========================================================================

    [Fact]
    public void XmlSpecialChars_Ampersand_ShouldFindAndAnchor()
    {
        var input = CreateDocx("xml-special.docx",
            "The treatment & control groups were compared.");
        var output = OutputPath("xml-special-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("treatment & control", "Author", "Clarify groups");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Contains("&", content.Comments[0].AnchorText);
    }

    [Fact]
    public void XmlSpecialChars_AngleBrackets_ShouldFindAndAnchor()
    {
        // p<0.001 is extremely common in clinical manuscripts
        var input = CreateDocx("xml-angles.docx",
            "The result was significant (p<0.001) after adjustment.");
        var output = OutputPath("xml-angles-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("p<0.001", "Author", "Check significance");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Contains("p<0.001", content.Comments[0].AnchorText);
    }

    [Fact]
    public void XmlSpecialChars_QuotesInText_ShouldFindAndAnchor()
    {
        var input = CreateDocx("xml-quotes.docx",
            "The \"gold standard\" approach was used throughout.");
        var output = OutputPath("xml-quotes-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("\"gold standard\"", "Author", "Needs citation");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Contains("gold standard", content.Comments[0].AnchorText);
    }

    // ========================================================================
    // 8. Search in an empty document
    // ========================================================================

    [Fact]
    public void EmptyDocument_NoParagraphs_ShouldThrowCleanly()
    {
        var input = CreateDocxWithBody("empty-doc.docx", body => { /* no paragraphs */ });
        var output = OutputPath("empty-doc-out.docx");

        using (var session = _writer.Open(input, output))
        {
            Assert.Throws<ArgumentException>(() =>
                session.AddCommentByText("anything", "Author", "Comment on nothing"));
        }
    }

    // ========================================================================
    // 9. Search in a document that is just tables
    // ========================================================================

    [Fact]
    public void TableOnlyDocument_CommentsOnTableCellText()
    {
        // Table cells are searchable now (Descendants<Paragraph>()): a comment on
        // cell text succeeds and the document is not corrupted.
        var input = CreateDocxWithBody("table-only.docx", body =>
        {
            var table = new Table(
                new TableRow(
                    new TableCell(new Paragraph(new Run(new Text("Cell text that should be found"))))));
            body.Append(table);
        });
        var output = OutputPath("table-only-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var id = session.AddCommentByText("Cell text", "Author", "Table text");
            Assert.False(string.IsNullOrEmpty(id));
        }
    }

    // ========================================================================
    // 10. Add 50 comments to the same paragraph
    // ========================================================================

    [Fact]
    public void ManyComments_50OnSameParagraph_ShouldNotCorruptIDs()
    {
        var longText = string.Join(". ", Enumerable.Range(1, 50).Select(i => $"Sentence number {i} is here"));
        var input = CreateDocx("many-comments.docx", longText);
        var output = OutputPath("many-comments-out.docx");

        List<string> ids;
        List<string> errors;

        using (var session = _writer.Open(input, output))
        {
            ids = new List<string>();
            for (int i = 1; i <= 50; i++)
            {
                var id = session.AddCommentByText($"Sentence number {i}", $"Author {i}", $"Comment {i}");
                ids.Add(id);
            }
            session.Save();

            // All IDs should be unique
            Assert.Equal(50, ids.Distinct().Count());

            errors = session.Validate();
        }

        // Verify all IDs are valid non-empty strings
        Assert.All(ids, id => Assert.False(string.IsNullOrEmpty(id)));

        var content = _reader.Read(output);
        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(50, totalComments);

        // Every comment should have anchor text containing "Sentence number"
        foreach (var comment in content.Comments)
        {
            Assert.Contains("Sentence number", comment.AnchorText);
        }
    }

    // ========================================================================
    // 11. Overlapping comment anchors
    // ========================================================================

    [Fact]
    public void OverlappingComments_TwoCommentsOverlappingRange()
    {
        // Two comments on overlapping text ranges. This tests whether interleaved
        // CommentRangeStart/End markers are handled properly.
        var input = CreateDocx("overlap.docx",
            "The gold standard for treatment of patients is well established.");
        var output = OutputPath("overlap-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var id1 = session.AddCommentByText("gold standard for treatment", "Dr. A", "First overlap");
            var id2 = session.AddCommentByText("treatment of patients", "Dr. B", "Second overlap");
            session.Save();
            Assert.NotEqual(id1, id2);
        }

        var content = _reader.Read(output);
        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(2, totalComments);
    }

    // ========================================================================
    // 12. Comment on the very first character of the document
    // ========================================================================

    [Fact]
    public void FirstCharacter_CommentAtDocStart()
    {
        var input = CreateDocx("first-char.docx",
            "Treatment was administered to all patients.");
        var output = OutputPath("first-char-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("T", "Author", "Comment on first character");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal("T", content.Comments[0].AnchorText);
    }

    // ========================================================================
    // 13. Comment on the very last character of the document
    // ========================================================================

    [Fact]
    public void LastCharacter_CommentAtDocEnd()
    {
        var input = CreateDocx("last-char.docx",
            "Treatment was administered.");
        var output = OutputPath("last-char-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText(".", "Author", "Comment on period");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal(".", content.Comments[0].AnchorText);
    }

    // ========================================================================
    // 14. Comment where anchor text is the entire paragraph
    // ========================================================================

    [Fact]
    public void EntireParagraph_CommentCoversAll()
    {
        var text = "This entire paragraph should be covered by the comment anchor.";
        var input = CreateDocx("entire-para.docx", text);
        var output = OutputPath("entire-para-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText(text, "Author", "Covers everything");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal(text, content.Comments[0].AnchorText);
    }

    // ========================================================================
    // 15. Nested comments -- comment B is fully inside comment A's range
    // ========================================================================

    [Fact]
    public void NestedComments_InnerWithinOuter()
    {
        // After adding the outer comment, the paragraph's runs are split.
        // The inner comment must still find "standard" and anchor correctly.
        var input = CreateDocx("nested.docx",
            "The gold standard for treatment is well established in literature.");
        var output = OutputPath("nested-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var idOuter = session.AddCommentByText("gold standard for treatment", "Dr. A", "Outer comment");
            var idInner = session.AddCommentByText("standard", "Dr. B", "Inner comment");
            session.Save();
            Assert.NotEqual(idOuter, idInner);
        }

        var content = _reader.Read(output);
        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(2, totalComments);

        var anchors = content.Comments.Select(c => c.AnchorText).ToList();
        Assert.Contains(anchors, a => a.Contains("standard"));
    }

    // ========================================================================
    // 16. Reply chain of depth 10
    // ========================================================================

    [Fact]
    public void DeepReplyChain_Depth10_ShouldNotCorrupt()
    {
        var input = CreateDocx("deep-reply.docx",
            "Clinical research is the cornerstone of evidence-based medicine.");
        var output = OutputPath("deep-reply-out.docx");

        List<string> allIds;
        using (var session = _writer.Open(input, output))
        {
            var rootId = session.AddCommentByText("cornerstone", "Root Author", "Root comment");
            allIds = new List<string> { rootId };

            var currentId = rootId;
            for (int i = 1; i <= 10; i++)
            {
                currentId = session.AddCommentReply(currentId, $"Author {i}", $"Reply level {i}");
                allIds.Add(currentId);
            }

            // All 11 IDs must be unique
            Assert.Equal(11, allIds.Distinct().Count());

            var errors = session.Validate();
            session.Save();
        }

        var content = _reader.Read(output);
        int CountAll(List<DocComment> comments)
        {
            int count = 0;
            foreach (var c in comments)
            {
                count++;
                count += CountAll(c.Replies);
            }
            return count;
        }

        var total = CountAll(content.Comments);
        Assert.Equal(11, total); // 1 root + 10 replies

        // Verify the root comment exists and is anchored to "cornerstone"
        Assert.Single(content.Comments);
        Assert.Equal("cornerstone", content.Comments[0].AnchorText);
        Assert.Equal("Root Author", content.Comments[0].Author);
    }

    // ========================================================================
    // 17. Reply to a non-existent comment ID
    // ========================================================================

    [Fact]
    public void ReplyToNonExistentId_ShouldThrow()
    {
        // BUG: When there is no comments part at all, AddCommentReply throws
        // InvalidOperationException ("Document has no comments") instead of
        // ArgumentException ("Parent comment 999 not found"). The error is
        // correct in spirit but the exception type is inconsistent — callers
        // catching ArgumentException will miss this case.
        var input = CreateDocx("reply-missing.docx",
            "Some text in the document.");
        var output = OutputPath("reply-missing-out.docx");

        using (var session = _writer.Open(input, output))
        {
            // Accept either ArgumentException or InvalidOperationException
            var threw = false;
            try
            {
                session.AddCommentReply("999", "Author", "Reply to nothing");
            }
            catch (ArgumentException)
            {
                threw = true;
            }
            catch (InvalidOperationException)
            {
                // BUG: This is the actual behavior — throws InvalidOperationException
                // because there's no comments part. The error message is "Document has
                // no comments" rather than "Parent comment 999 not found".
                threw = true;
            }

            Assert.True(threw, "AddCommentReply to non-existent ID should throw an exception");
        }
    }

    // ========================================================================
    // 18. Multiple replies to the same comment (5 different authors)
    // ========================================================================

    [Fact]
    public void MultipleRepliesToSameComment_5Authors()
    {
        var input = CreateDocx("multi-reply.docx",
            "The study design was appropriate for the research question.");
        var output = OutputPath("multi-reply-out.docx");

        List<string> replyIds;
        using (var session = _writer.Open(input, output))
        {
            var rootId = session.AddCommentByText("study design", "Lead Author", "Is this right?");
            replyIds = new List<string>();
            for (int i = 1; i <= 5; i++)
            {
                var replyId = session.AddCommentReply(rootId, $"Reviewer {i}", $"Reply from reviewer {i}");
                replyIds.Add(replyId);
            }
            session.Save();
        }

        // All reply IDs should be unique
        Assert.Equal(5, replyIds.Distinct().Count());

        var content = _reader.Read(output);
        Assert.Single(content.Comments); // 1 root
        Assert.Equal(5, content.Comments[0].Replies.Count);
    }

    // ========================================================================
    // 19. Delete text that contains special characters
    // ========================================================================

    [Fact]
    public void DeleteSpecialChars_EmDash()
    {
        var input = CreateDocx("delete-emdash.docx",
            "The treatment — a novel approach — was effective.");
        var output = OutputPath("delete-emdash-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddTrackedDeletionByText("— a novel approach —", "Author");
            session.Save();
        }

        var content = _reader.Read(output);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(deletions);
        Assert.Contains("—", deletions[0].Text);
    }

    [Fact]
    public void DeleteSpecialChars_SmartQuotes()
    {
        var input = CreateDocx("delete-smartquotes.docx",
            "The “gold standard” approach was used.");
        var output = OutputPath("delete-smartquotes-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddTrackedDeletionByText("“gold standard”", "Author");
            session.Save();
        }

        var content = _reader.Read(output);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(deletions);
        Assert.Contains("gold standard", deletions[0].Text);
    }

    // ========================================================================
    // 20. Replace text that appears multiple times
    // ========================================================================

    [Fact]
    public void ReplaceMultipleOccurrences_OnlyFirstIsReplaced()
    {
        // LIMITATION: AddTrackedInsertionByText uses FindText which returns first match only
        var input = CreateDocx("replace-multi.docx",
            "The treatment improved outcomes. The treatment was well tolerated.");
        var output = OutputPath("replace-multi-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddTrackedInsertionByText("treatment", "novel therapy", "replace", "Author");
            session.Save();
        }

        var content = _reader.Read(output);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();

        // Only the first occurrence should be replaced
        Assert.Single(deletions);
        Assert.Single(insertions);
        Assert.Equal("treatment", deletions[0].Text);
        Assert.Equal("novel therapy", insertions[0].Text);

        // The second "treatment" should still be in the paragraph text
        Assert.Contains("treatment", content.Paragraphs[0].Text);
    }

    // ========================================================================
    // 21. Insert + delete on the same paragraph in one session
    // ========================================================================

    [Fact]
    public void InsertAndDelete_SameParagraph_OrderOfOperations()
    {
        // BUG: After a tracked deletion modifies the paragraph's run structure,
        // subsequent operations use FindText which re-reads the paragraph text.
        // The deleted text is still present (as DeletedRun), but the TextSearcher
        // excludes it -- so offsets may shift. This could cause misalignment.
        var input = CreateDocx("insert-delete-same.docx",
            "The gold standard treatment showed significant improvement.");
        var output = OutputPath("insert-delete-same-out.docx");

        using (var session = _writer.Open(input, output))
        {
            // First: delete "gold standard"
            session.AddTrackedDeletionByText("gold standard", "Dr. A");
            // Second: insert text after "significant" (which is still there)
            session.AddTrackedInsertionByText("significant", " (p<0.001)", "after", "Dr. B");
            session.Save();
        }

        var content = _reader.Read(output);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();

        Assert.Single(deletions);
        Assert.Contains(insertions, i => i.Text.Contains("p<0.001"));
    }

    // ========================================================================
    // 22. Delete text that's already a tracked insertion
    // ========================================================================

    [Fact]
    public void DeleteTrackedInsertion_ShouldHandleGracefully()
    {
        // BUG: InsertedRun text is included by TextSearcher.GetParagraphPlainText,
        // so FindText will find it. But the text lives inside an InsertedRun, not
        // a regular Run. MarkTextAsDeleted only walks para.Elements<Run>(),
        // so it misses InsertedRun children. The result is a silent no-op:
        // the operation "succeeds" but produces no tracked deletion.
        var input = CreateDocxWithBody("delete-insertion.docx", body =>
        {
            var para = new Paragraph();
            para.Append(new Run(new Text("Baseline text. ") { Space = SpaceProcessingModeValues.Preserve }));
            var ins = new InsertedRun
            {
                Author = "Dr. Smith",
                Date = DateTime.UtcNow,
                Id = "1"
            };
            ins.Append(new Run(new Text("Inserted addition.") { Space = SpaceProcessingModeValues.Preserve }));
            para.Append(ins);
            body.Append(para);
        });
        var output = OutputPath("delete-insertion-out.docx");

        using (var session = _writer.Open(input, output))
        {
            // FindText will find "Inserted addition." because GetParagraphPlainText
            // includes InsertedRun text. But MarkTextAsDeleted only walks regular Runs.
            session.AddTrackedDeletionByText("Inserted addition.", "Dr. B");
            session.Save();
        }

        var content = _reader.Read(output);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();

        // Fixed: MarkTextAsDeleted now walks into InsertedRun elements.
        // This must produce an actual tracked deletion, not a silent no-op.
        Assert.Single(deletions);
        Assert.Contains("Inserted addition", deletions[0].Text);
    }

    // ========================================================================
    // 23. Validate after every adversarial operation
    // ========================================================================

    [Fact]
    public void ValidationAfterMixedOperations()
    {
        var input = CreateDocx("validate-mixed.docx",
            "First sentence of the document.",
            "Second sentence with important content.",
            "Third sentence about clinical research.",
            "Fourth sentence discussing treatment options.");
        var output = OutputPath("validate-mixed-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var id1 = session.AddCommentByText("First sentence", "Dr. A", "Comment 1");
            var id2 = session.AddCommentByText("important content", "Dr. B", "Comment 2");
            session.AddTrackedInsertionByText("clinical research", " methodology", "after", "Dr. C");
            session.AddTrackedDeletionByText("treatment options", "Dr. D");
            session.Save();

            // Comment IDs should be valid
            Assert.False(string.IsNullOrEmpty(id1));
            Assert.False(string.IsNullOrEmpty(id2));
            Assert.NotEqual(id1, id2);

            var errors = session.Validate();
            var structuralErrors = errors.Where(e =>
                e.Contains("[Schema]") || e.Contains("[Semantic]")).ToList();

            // No structural validation errors after mixed operations
            Assert.Empty(structuralErrors);
        }

        var content = _reader.Read(output);
        Assert.Equal(4, content.Paragraphs.Count);

        // Verify 2 comments were added
        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(2, totalComments);

        // Verify tracked changes: 1 insertion + 1 deletion
        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(insertions);
        Assert.Contains("methodology", insertions[0].Text);
        Assert.Single(deletions);
        Assert.Equal("treatment options", deletions[0].Text);
    }

    // ========================================================================
    // 24. Re-read after adversarial writes (roundtrip)
    // ========================================================================

    [Fact]
    public void Roundtrip_WriteAndReadBack_PreservesContent()
    {
        var originalTexts = new[]
        {
            "Die Studie untersuchte den Einfluss von Lebensstiländerungen.",
            "Ergebnisse zeigten eine signifikante Verbesserung (p<0.001).",
            "Die Lebensqualität der Patienten verbesserte sich — besonders im ersten Quartal."
        };

        var input = CreateDocx("roundtrip.docx", originalTexts);
        var output = OutputPath("roundtrip-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddCommentByText("Lebensstiländerungen", "Dr. Müller", "Genauer definieren");
            session.AddCommentByText("p<0.001", "Dr. Schmidt", "Prüfen");
            session.AddTrackedInsertionByText("ersten Quartal", " (Monate 1–3)", "after", "Dr. Weber");
            session.Save();
        }

        var content = _reader.Read(output);

        Assert.Equal(3, content.Paragraphs.Count);
        Assert.Contains("Studie", content.Paragraphs[0].Text);
        Assert.Contains("signifikante", content.Paragraphs[1].Text);
        Assert.Contains("Lebensqualität", content.Paragraphs[2].Text);

        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(2, totalComments);

        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        Assert.Single(insertions);
    }

    // ========================================================================
    // Additional edge cases
    // ========================================================================

    [Fact]
    public void SingleCharacterParagraph_CommentOnIt()
    {
        var input = CreateDocx("single-char.docx", "X");
        var output = OutputPath("single-char-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("X", "Author", "Just one character");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal("X", content.Comments[0].AnchorText);
    }

    [Fact]
    public void FragmentedRuns_AnchorSpansThreeRuns()
    {
        // Anchor text "beta gamma" starts mid-paragraph at run 2 and spans into run 3
        var input = CreateDocxWithBody("frag-3runs.docx", body =>
        {
            var para = new Paragraph(
                new Run(new Text("alpha ") { Space = SpaceProcessingModeValues.Preserve }),
                new Run(new Text("beta ") { Space = SpaceProcessingModeValues.Preserve }),
                new Run(new Text("gamma ") { Space = SpaceProcessingModeValues.Preserve }),
                new Run(new Text("delta") { Space = SpaceProcessingModeValues.Preserve })
            );
            body.Append(para);
        });
        var output = OutputPath("frag-3runs-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("beta gamma", "Author", "Spans runs");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal("beta gamma", content.Comments[0].AnchorText);
    }

    [Fact]
    public void CommentAndTrackedChange_OnSameText()
    {
        // Comment + tracked deletion on the exact same text range
        var input = CreateDocx("comment-and-delete.docx",
            "The obsolete method was previously considered acceptable.");
        var output = OutputPath("comment-and-delete-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddCommentByText("obsolete method", "Dr. A", "This should be removed");
            session.AddTrackedDeletionByText("obsolete method", "Dr. B");
            session.Save();
        }

        var content = _reader.Read(output);
        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.True(totalComments >= 1, "Comment should survive the tracked deletion");
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(deletions);
    }

    [Fact]
    public void WhitespaceOnlyParagraph_ShouldNotCrash()
    {
        var input = CreateDocx("whitespace-para.docx",
            "Normal text before.",
            "   ",
            "Normal text after.");
        var output = OutputPath("whitespace-para-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("Normal text after", "Author", "Test");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
    }

    [Fact]
    public void ResolveComment_ThenReply_ShouldNotCorrupt()
    {
        var input = CreateDocx("resolve-then-reply.docx",
            "The study included 500 participants.");
        var output = OutputPath("resolve-then-reply-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var rootId = session.AddCommentByText("500 participants", "Dr. A", "Sample size adequate?");
            session.ResolveComment(rootId);
            var replyId = session.AddCommentReply(rootId, "Dr. B", "Yes, power analysis confirms.");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Single(content.Comments[0].Replies);
    }

    [Fact]
    public void EmptyAuthor_ShouldNotCrash()
    {
        // Edge case: empty author string
        var input = CreateDocx("empty-author.docx",
            "Some text to comment on.");
        var output = OutputPath("empty-author-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("Some text", "", "Anonymous comment");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        Assert.Equal("", content.Comments[0].Author);
    }

    [Fact]
    public void InsertEmptyString_ShouldNotCorrupt()
    {
        // Edge case: inserting an empty string as a tracked change
        var input = CreateDocx("insert-empty.docx",
            "Text before anchor text after.");
        var output = OutputPath("insert-empty-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddTrackedInsertionByText("anchor", "", "after", "Author");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.NotNull(content);
    }

    [Fact]
    public void DeleteEntireParagraphText_ShouldNotCrash()
    {
        // Delete ALL text in a paragraph
        var text = "This entire paragraph will be deleted.";
        var input = CreateDocx("delete-all.docx",
            text,
            "Second paragraph survives.");
        var output = OutputPath("delete-all-out.docx");

        using (var session = _writer.Open(input, output))
        {
            session.AddTrackedDeletionByText(text, "Author");
            session.Save();
        }

        var content = _reader.Read(output);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(deletions);
        Assert.Equal(text, deletions[0].Text);
    }

    [Fact]
    public void CommentOnTextWithTrailingSpace_ShouldAnchorCorrectly()
    {
        var input = CreateDocx("trailing-space.docx",
            "The treatment group and control group were compared.");
        var output = OutputPath("trailing-space-out.docx");

        using (var session = _writer.Open(input, output))
        {
            var commentId = session.AddCommentByText("treatment group ", "Author", "Note trailing space");
            session.Save();
        }

        var content = _reader.Read(output);
        Assert.Single(content.Comments);
        // The anchor should include the trailing space
        Assert.Equal("treatment group ", content.Comments[0].AnchorText);
    }
}
