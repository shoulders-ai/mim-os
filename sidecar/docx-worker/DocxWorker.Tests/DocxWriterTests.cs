using DocxWorker;

namespace DocxWorker.Tests;

public class DocxWriterTests : IDisposable
{
    private readonly string _fixtureDir;
    private readonly string _outputDir;
    private readonly DocxReader _reader;
    private readonly DocxWriter _writer;

    public DocxWriterTests()
    {
        _fixtureDir = Path.Combine(Path.GetTempPath(), "docxworker-test-fixtures-w-" + Guid.NewGuid().ToString("N")[..8]);
        _outputDir = Path.Combine(Path.GetTempPath(), "docxworker-test-output-w-" + Guid.NewGuid().ToString("N")[..8]);
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
    public void AddComment_CreatesValidComment()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "add-comment-test.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            var commentId = session.AddComment(new AddCommentOperation
            {
                ParagraphIndex = 1, // First prose paragraph
                StartCharOffset = 0,
                EndCharOffset = 17, // "Clinical research"
                Author = "AI Agent",
                CommentText = "This is a key claim that needs a citation."
            });
            session.Save();

            Assert.NotNull(commentId);
            Assert.NotEmpty(commentId);
        }

        // Read it back
        var content = _reader.Read(outputPath);
        Assert.Single(content.Comments);

        var comment = content.Comments[0];
        Assert.Equal("AI Agent", comment.Author);
        Assert.Contains("key claim", comment.Text);
    }

    [Fact]
    public void AddComment_PreservesExistingContent()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "preserve-content-test.docx");

        // Read original content
        var originalContent = _reader.Read(inputPath);

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddComment(new AddCommentOperation
            {
                ParagraphIndex = 2,
                StartCharOffset = 0,
                EndCharOffset = 10,
                Author = "Test",
                CommentText = "Test comment"
            });
            session.Save();
        }

        // Read modified content
        var modifiedContent = _reader.Read(outputPath);

        // Same number of paragraphs
        Assert.Equal(originalContent.Paragraphs.Count, modifiedContent.Paragraphs.Count);

        // Text content is preserved (paragraph text should be the same)
        for (int i = 0; i < originalContent.Paragraphs.Count; i++)
        {
            Assert.Equal(originalContent.Paragraphs[i].Text, modifiedContent.Paragraphs[i].Text);
        }
    }

    [Fact]
    public void AddComment_DoesNotModifyOriginal()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "no-modify-original-test.docx");

        // Read original
        var beforeContent = _reader.Read(inputPath);

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddComment(new AddCommentOperation
            {
                ParagraphIndex = 1,
                StartCharOffset = 0,
                EndCharOffset = 5,
                Author = "Test",
                CommentText = "Test"
            });
            session.Save();
        }

        // Read original again — should be unchanged
        var afterContent = _reader.Read(inputPath);
        Assert.Equal(beforeContent.Comments.Count, afterContent.Comments.Count);
        Assert.Equal(beforeContent.Paragraphs.Count, afterContent.Paragraphs.Count);
    }

    [Fact]
    public void AddCommentReply_ThreadsCorrectly()
    {
        var inputPath = Path.Combine(_fixtureDir, "with-comments.docx");
        var outputPath = Path.Combine(_outputDir, "reply-test.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddCommentReply(new AddCommentReplyOperation
            {
                ParentCommentId = "1",
                Author = "AI Agent",
                ReplyText = "I have reviewed this and agree with the suggestion."
            });
            session.Save();
        }

        // Read it back — the new reply should be present as a comment
        var content = _reader.Read(outputPath);

        // We should still have the original comments plus the new one
        var allCommentTexts = new List<string>();
        foreach (var c in content.Comments)
        {
            allCommentTexts.Add(c.Text);
            foreach (var r in c.Replies)
                allCommentTexts.Add(r.Text);
        }

        Assert.Contains(allCommentTexts, t => t.Contains("reviewed this"));
    }

    [Fact]
    public void AddTrackedInsertion_CreatesRevision()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "tracked-insert-test.docx");

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddTrackedInsertion(new AddTrackedInsertionOperation
            {
                ParagraphIndex = 1,
                Position = 17, // After "Clinical research"
                TextToInsert = " methodology",
                Author = "AI Agent"
            });
            session.Save();
        }

        // Read it back
        var content = _reader.Read(outputPath);

        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        Assert.Single(insertions);
        Assert.Contains("methodology", insertions[0].Text);
        Assert.Equal("AI Agent", insertions[0].Author);
    }

    [Fact]
    public void AddTrackedDeletion_CreatesRevision()
    {
        var inputPath = Path.Combine(_fixtureDir, "simple.docx");
        var outputPath = Path.Combine(_outputDir, "tracked-delete-test.docx");

        // First read to know what text is there
        var originalContent = _reader.Read(inputPath);
        var para1Text = originalContent.Paragraphs[1].Text;

        using (var session = _writer.Open(inputPath, outputPath))
        {
            // Delete "Clinical research" (first 17 chars of paragraph 1)
            session.AddTrackedDeletion(new AddTrackedDeletionOperation
            {
                ParagraphIndex = 1,
                StartOffset = 0,
                EndOffset = 17,
                Author = "AI Agent"
            });
            session.Save();
        }

        // Read it back
        var content = _reader.Read(outputPath);

        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();
        Assert.Single(deletions);
        Assert.Equal("AI Agent", deletions[0].Author);
    }

    [Fact]
    public void RoundTrip_PreservesExistingComments()
    {
        var inputPath = Path.Combine(_fixtureDir, "with-comments.docx");
        var outputPath = Path.Combine(_outputDir, "roundtrip-test.docx");

        // Read original
        var originalContent = _reader.Read(inputPath);
        var originalCommentCount = originalContent.Comments.Count +
            originalContent.Comments.Sum(c => c.Replies.Count);

        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddComment(new AddCommentOperation
            {
                ParagraphIndex = 1,
                StartCharOffset = 0,
                EndCharOffset = 10,
                Author = "New Reviewer",
                CommentText = "Additional note."
            });
            session.Save();
        }

        // Read modified
        var modifiedContent = _reader.Read(outputPath);
        var modifiedCommentCount = modifiedContent.Comments.Count +
            modifiedContent.Comments.Sum(c => c.Replies.Count);

        // Should have one more comment than before
        Assert.Equal(originalCommentCount + 1, modifiedCommentCount);

        // Original comment content should still be present
        var allTexts = modifiedContent.Comments.SelectMany(c =>
            new[] { c.Text }.Concat(c.Replies.Select(r => r.Text))).ToList();
        Assert.Contains(allTexts, t => t.Contains("Cochrane"));
        Assert.Contains(allTexts, t => t.Contains("Additional note"));
    }
}

// Additional tests for fragmented runs and validation
public class FragmentedRunTests : IDisposable
{
    private readonly string _outputDir;
    private readonly DocxReader _reader = new();
    private readonly DocxWriter _writer = new();

    public FragmentedRunTests()
    {
        _outputDir = Path.Combine(Path.GetTempPath(), "docxworker-frag-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_outputDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_outputDir))
            Directory.Delete(_outputDir, recursive: true);
    }

    [Fact]
    public void AddComment_SpanningMultipleRuns_Works()
    {
        // Create a doc with text split across multiple runs (like real Word does)
        var inputPath = Path.Combine(_outputDir, "fragmented.docx");
        using (var doc = DocumentFormat.OpenXml.Packaging.WordprocessingDocument.Create(
            inputPath, DocumentFormat.OpenXml.WordprocessingDocumentType.Document))
        {
            var mainPart = doc.AddMainDocumentPart();
            mainPart.Document = new DocumentFormat.OpenXml.Wordprocessing.Document(
                new DocumentFormat.OpenXml.Wordprocessing.Body(
                    new DocumentFormat.OpenXml.Wordprocessing.Paragraph(
                        // "Observational Study Information is important" split into 4 runs
                        new DocumentFormat.OpenXml.Wordprocessing.Run(
                            new DocumentFormat.OpenXml.Wordprocessing.Text("Observational Study")
                            { Space = DocumentFormat.OpenXml.SpaceProcessingModeValues.Preserve }),
                        new DocumentFormat.OpenXml.Wordprocessing.Run(
                            new DocumentFormat.OpenXml.Wordprocessing.Text(" ")
                            { Space = DocumentFormat.OpenXml.SpaceProcessingModeValues.Preserve }),
                        new DocumentFormat.OpenXml.Wordprocessing.Run(
                            new DocumentFormat.OpenXml.Wordprocessing.Text("Information")
                            { Space = DocumentFormat.OpenXml.SpaceProcessingModeValues.Preserve }),
                        new DocumentFormat.OpenXml.Wordprocessing.Run(
                            new DocumentFormat.OpenXml.Wordprocessing.Text(" is important for research.")
                            { Space = DocumentFormat.OpenXml.SpaceProcessingModeValues.Preserve })
                    )
                )
            );
        }

        // Add comment on "Study Information" which spans runs 0-2
        // "Observational Study Information is important for research."
        //  01234567890123456789012345678901
        // "Study" starts at 14, "Information" ends at 31 (exclusive)
        // Run 0: "Observational Study" (0-18, 19 chars)
        // Run 1: " " (19, 1 char)
        // Run 2: "Information" (20-30, 11 chars)
        // "Study Information" = positions 14..30 inclusive = endOffset 31 (exclusive)
        var outputPath = Path.Combine(_outputDir, "fragmented-commented.docx");
        using (var session = _writer.Open(inputPath, outputPath))
        {
            session.AddComment(new DocxWorker.AddCommentOperation
            {
                ParagraphIndex = 0,
                StartCharOffset = 14,  // start of "Study"
                EndCharOffset = 31,    // exclusive end after "Information"
                Author = "AI Agent",
                CommentText = "This spans multiple runs"
            });
            session.Save();
        }

        // Read back and verify
        var content = _reader.Read(outputPath);
        Assert.Single(content.Comments);
        var comment = content.Comments[0];
        Assert.Equal("AI Agent", comment.Author);
        Assert.Contains("spans multiple runs", comment.Text);
        // The anchor text should be "Study Information"
        Assert.Equal("Study Information", comment.AnchorText);
    }
}
