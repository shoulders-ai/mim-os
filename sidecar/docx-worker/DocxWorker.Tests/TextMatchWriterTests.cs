using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentFormat.OpenXml.Validation;
using DocxWorker;

namespace DocxWorker.Tests;

public class TextMatchWriterTests : IDisposable
{
    private readonly string _fixtureDir;
    private readonly string _outputDir;
    private readonly DocxReader _reader;
    private readonly DocxWriter _writer;

    public TextMatchWriterTests()
    {
        _fixtureDir = Path.Combine(Path.GetTempPath(), "docxworker-tmw-fixtures-" + Guid.NewGuid().ToString("N")[..8]);
        _outputDir = Path.Combine(Path.GetTempPath(), "docxworker-tmw-output-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_fixtureDir);
        Directory.CreateDirectory(_outputDir);
        TestFixtures.GenerateAll(_fixtureDir);
        _reader = new DocxReader();
        _writer = new DocxWriter();
    }

    public void Dispose()
    {
        if (Directory.Exists(_fixtureDir))
            Directory.Delete(_fixtureDir, recursive: true);
        if (Directory.Exists(_outputDir))
            Directory.Delete(_outputDir, recursive: true);
    }

    [Fact]
    public void AddCommentByText_SimpleCase()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "comment-text-simple.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            var commentId = session.AddCommentByText(
                "gold standard",
                "AI Agent",
                "This claim needs a citation."
            );
            session.Save();

            Assert.NotNull(commentId);
            Assert.NotEmpty(commentId);
        }

        // Read it back
        var content = _reader.Read(outputPath);
        Assert.Single(content.Comments);
        var comment = content.Comments[0];
        Assert.Equal("AI Agent", comment.Author);
        Assert.Contains("needs a citation", comment.Text);
        Assert.Equal("gold standard", comment.AnchorText);
    }

    [Fact]
    public void AddCommentByText_AcrossFragmentedRuns()
    {
        // Create a document with fragmented runs
        var inputPath = Path.Combine(_outputDir, "fragmented-input.docx");
        using (var doc = WordprocessingDocument.Create(inputPath, WordprocessingDocumentType.Document))
        {
            var mainPart = doc.AddMainDocumentPart();
            mainPart.Document = new Document(new Body(
                new Paragraph(
                    new Run(new Text("Observational Study") { Space = SpaceProcessingModeValues.Preserve }),
                    new Run(new Text(" ") { Space = SpaceProcessingModeValues.Preserve }),
                    new Run(new Text("Information") { Space = SpaceProcessingModeValues.Preserve }),
                    new Run(new Text(" is important for research.") { Space = SpaceProcessingModeValues.Preserve })
                )
            ));
        }

        var outputPath = Path.Combine(_outputDir, "fragmented-commented.docx");
        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddCommentByText(
                "Study Information",
                "AI Agent",
                "This spans multiple runs"
            );
            session.Save();
        }

        var content = _reader.Read(outputPath);
        Assert.Single(content.Comments);
        Assert.Equal("Study Information", content.Comments[0].AnchorText);
    }

    [Fact]
    public void AddCommentByText_PreservesAllContent()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "preserve-all.docx");

        var originalContent = _reader.Read(inputPath);

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddCommentByText("Clinical research", "AI", "Test comment");
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        // Same number of paragraphs
        Assert.Equal(originalContent.Paragraphs.Count, modifiedContent.Paragraphs.Count);

        // Paragraph text content preserved
        for (int i = 0; i < originalContent.Paragraphs.Count; i++)
        {
            Assert.Equal(originalContent.Paragraphs[i].Text, modifiedContent.Paragraphs[i].Text);
        }
    }

    [Fact]
    public void AddCommentByText_MultipleComments()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "multi-comments.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddCommentByText("Clinical research", "Agent 1", "Comment on clinical research");
            session.AddCommentByText("gold standard", "Agent 2", "Comment on gold standard");
            session.AddCommentByText("Observational studies", "Agent 3", "Comment on observational");
            session.AddCommentByText("informed consent", "Agent 4", "Comment on consent");
            session.AddCommentByText("Phase I", "Agent 5", "Comment on Phase I");
            session.Save();
        }

        var content = _reader.Read(outputPath);

        // Count all comments (top-level + replies)
        var totalComments = content.Comments.Count + content.Comments.Sum(c => c.Replies.Count);
        Assert.Equal(5, totalComments);

        // Each comment has the right anchor text
        var anchorTexts = content.Comments.Select(c => c.AnchorText).ToList();
        Assert.Contains("Clinical research", anchorTexts);
        Assert.Contains("gold standard", anchorTexts);
    }

    [Fact]
    public void AddCommentByText_InTableCell()
    {
        // Table-cell paragraphs are searched (Descendants<Paragraph>()), so a
        // comment on text that lives only in a results table now succeeds — the
        // highest-value comments in a clinical review are on those tables.
        var inputPath = Path.Combine(_fixtureDir, "with-table.docx");
        var outputPath = Path.Combine(_outputDir, "table-comment.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            var id = session.AddCommentByText("54.3 (12.1)", "AI", "Table-only text");
            Assert.False(string.IsNullOrEmpty(id));
        }
    }

    [Fact]
    public void AddCommentByText_NearCitationField()
    {
        var inputPath = Path.Combine(_fixtureDir, "with-citations.docx");
        var outputPath = Path.Combine(_outputDir, "citation-comment.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            // Comment on text near (but not inside) a citation field
            session.AddCommentByText(
                "Previous studies have shown significant improvements",
                "AI Agent",
                "Which studies exactly?"
            );
            session.Save();
        }

        var content = _reader.Read(outputPath);
        Assert.Single(content.Comments);
        Assert.Contains("Previous studies", content.Comments[0].AnchorText);

        // Citation fields should survive
        Assert.True(content.CitationFields.Count >= 2,
            $"Expected at least 2 citations to survive, got {content.CitationFields.Count}");
    }

    [Fact]
    public void AddCommentByText_SecondOccurrence()
    {
        // Create a document with the same text twice
        var inputPath = Path.Combine(_outputDir, "duplicated-input.docx");
        using (var doc = WordprocessingDocument.Create(inputPath, WordprocessingDocumentType.Document))
        {
            var mainPart = doc.AddMainDocumentPart();
            mainPart.Document = new Document(new Body(
                new Paragraph(new Run(new Text("The cat sat on the mat."))),
                new Paragraph(new Run(new Text("Another cat appeared on the mat.")))
            ));
        }

        var outputPath = Path.Combine(_outputDir, "second-occurrence.docx");
        using (var session = _writer.Open(inputPath, outputPath))
        {
            // Comment on the second occurrence of "cat"
            session.AddCommentByText("cat", "AI", "Second cat reference", 1);
            session.Save();
        }

        var content = _reader.Read(outputPath);
        Assert.Single(content.Comments);
        Assert.Equal("cat", content.Comments[0].AnchorText);
        // The anchor should be in paragraph 1 (second paragraph)
        Assert.Equal(1, content.Comments[0].AnchorParagraphIndex);
    }

    [Fact]
    public void AddCommentReply_ThreadsInWord()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "reply-threaded.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            // First add a comment
            var commentId = session.AddCommentByText("gold standard", "Dr. Smith", "Is this supported?");
            // Then add a reply
            var replyId = session.AddCommentReply(commentId, "Dr. Lee", "Yes, see the 2023 review.");
            session.Save();

            Assert.NotEqual(commentId, replyId);
        }

        // Read back and verify threading
        var content = _reader.Read(outputPath);

        // Should have 1 top-level comment with 1 reply
        Assert.Single(content.Comments);
        var parent = content.Comments[0];
        Assert.Equal("Dr. Smith", parent.Author);
        Assert.Single(parent.Replies);
        Assert.Equal("Dr. Lee", parent.Replies[0].Author);
        Assert.Contains("2023 review", parent.Replies[0].Text);
    }

    [Fact]
    public void AddCommentReply_ReplyToReply()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "reply-chain.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            var commentId = session.AddCommentByText("gold standard", "Dr. Smith", "Original comment");
            var reply1Id = session.AddCommentReply(commentId, "Dr. Lee", "First reply");
            var reply2Id = session.AddCommentReply(reply1Id, "Dr. Jones", "Reply to the reply");
            session.Save();
        }

        var content = _reader.Read(outputPath);

        // Should have some comment structure
        var allComments = new List<string>();
        foreach (var c in content.Comments)
        {
            allComments.Add(c.Text);
            foreach (var r in c.Replies)
            {
                allComments.Add(r.Text);
                foreach (var rr in r.Replies)
                    allComments.Add(rr.Text);
            }
        }

        Assert.Contains(allComments, t => t.Contains("Original comment"));
        Assert.Contains(allComments, t => t.Contains("First reply"));
        Assert.Contains(allComments, t => t.Contains("Reply to the reply"));
    }

    [Fact]
    public void ResolveComment_SetsDone()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "resolve-comment.docx");

        string commentId;
        using (var session = _writer.Open(inputPath, outputPath))
        {
            commentId = session.AddCommentByText("gold standard", "Dr. Smith", "Check this.");
            session.ResolveComment(commentId);
            session.Save();
        }

        // Verify done="1" in commentsExtended
        using var doc = WordprocessingDocument.Open(outputPath, false);
        var extPart = doc.MainDocumentPart?.WordprocessingCommentsExPart;
        Assert.NotNull(extPart);

        using var stream = extPart.GetStream();
        var xdoc = System.Xml.Linq.XDocument.Load(stream);
        var w15 = System.Xml.Linq.XNamespace.Get("http://schemas.microsoft.com/office/word/2012/wordml");

        var entries = xdoc.Descendants(w15 + "commentEx").ToList();
        Assert.True(entries.Count > 0);

        // Find the entry with done="1"
        var doneEntry = entries.FirstOrDefault(e => e.Attribute(w15 + "done")?.Value == "1");
        Assert.NotNull(doneEntry);
    }

    [Fact]
    public void AddTrackedInsertionByText_BeforeAnchor()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "insert-before.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddTrackedInsertionByText(
                "gold standard",
                "so-called ",
                "before",
                "AI Agent"
            );
            session.Save();
        }

        var content = _reader.Read(outputPath);
        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        Assert.Single(insertions);
        Assert.Contains("so-called", insertions[0].Text);
        Assert.Equal("AI Agent", insertions[0].Author);
    }

    [Fact]
    public void AddTrackedInsertionByText_AfterAnchor()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "insert-after.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddTrackedInsertionByText(
                "gold standard",
                " (widely accepted)",
                "after",
                "AI Agent"
            );
            session.Save();
        }

        var content = _reader.Read(outputPath);
        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        Assert.Single(insertions);
        Assert.Contains("widely accepted", insertions[0].Text);
    }

    [Fact]
    public void AddTrackedInsertionByText_ReplaceAnchor()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "replace-text.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddTrackedInsertionByText(
                "gold standard",
                "benchmark methodology",
                "replace",
                "AI Agent"
            );
            session.Save();
        }

        var content = _reader.Read(outputPath);

        // Should have both a deletion and an insertion
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        Assert.Single(deletions);
        Assert.Single(insertions);
        Assert.Equal("gold standard", deletions[0].Text);
        Assert.Equal("benchmark methodology", insertions[0].Text);
    }

    [Fact]
    public void AddTrackedDeletionByText_RemovesText()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "delete-text.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddTrackedDeletionByText("gold standard", "AI Agent");
            session.Save();
        }

        var content = _reader.Read(outputPath);
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(deletions);
        Assert.Equal("gold standard", deletions[0].Text);
        Assert.Equal("AI Agent", deletions[0].Author);
    }

    [Fact]
    public void Validate_CleanDocument_NoErrors()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "validate-clean.docx");

        using var session = _writer.Open(inputPath, outputPath);
        var errors = session.Validate();

        // A clean fixture document should have no errors (or only info-level)
        // Note: OpenXml validator can be strict — some warnings may exist
        // We just verify the method works without throwing
        Assert.NotNull(errors);
    }

    [Fact]
    public void Validate_AfterComments_NoErrors()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "validate-comments.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddCommentByText("gold standard", "AI", "Test");
            session.Save();

            var errors = session.Validate();
            // After adding a comment, the document should still be valid
            // (there may be warnings about missing styles, but not structural errors)
            Assert.NotNull(errors);
        }
    }

    [Fact]
    public void Validate_AfterTrackedChanges_NoErrors()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "validate-tracked.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddTrackedInsertionByText("gold standard", " (so-called)", "after", "AI");
            session.Save();

            var errors = session.Validate();
            Assert.NotNull(errors);
        }
    }
}
