using DocxWorker;

namespace DocxWorker.Tests;

public class DocxReaderTests : IDisposable
{
    private readonly string _fixtureDir;
    private readonly DocxReader _reader;

    public DocxReaderTests()
    {
        _fixtureDir = Path.Combine(Path.GetTempPath(), "docxworker-test-fixtures-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_fixtureDir);
        TestFixtures.GenerateAll(_fixtureDir);
        _reader = new DocxReader();
    }

    public void Dispose()
    {
        if (Directory.Exists(_fixtureDir))
            Directory.Delete(_fixtureDir, recursive: true);
    }

    [Fact]
    public void ReadSimple_ExtractsParagraphs()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "simple.docx"));

        // 1 heading + 5 prose paragraphs + 3 list items = 9
        Assert.Equal(9, content.Paragraphs.Count);

        // First paragraph is a heading
        Assert.Equal("heading-1", content.Paragraphs[0].Type);
        Assert.Contains("Clinical Research", content.Paragraphs[0].Text);

        // Regular paragraphs
        Assert.Equal("normal", content.Paragraphs[1].Type);
        Assert.Contains("cornerstone", content.Paragraphs[1].Text);

        // Check paragraph indices are sequential
        for (int i = 0; i < content.Paragraphs.Count; i++)
        {
            Assert.Equal(i, content.Paragraphs[i].Index);
        }

        // Check content hash is populated
        Assert.All(content.Paragraphs, p => Assert.NotEmpty(p.ContentHash));

        // Check snippet is populated
        Assert.All(content.Paragraphs, p => Assert.NotEmpty(p.Snippet));
    }

    [Fact]
    public void ReadSimple_ExtractsListItems()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "simple.docx"));

        // Last 3 paragraphs are list items
        var listItems = content.Paragraphs.Where(p => p.Type == "bullet-list").ToList();
        Assert.Equal(3, listItems.Count);

        Assert.Contains("Phase I", listItems[0].Text);
        Assert.Contains("Phase II", listItems[1].Text);
        Assert.Contains("Phase III", listItems[2].Text);
    }

    [Fact]
    public void ReadSimple_ExtractsMetadata()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "simple.docx"));

        Assert.Equal("Simple Test Document", content.Metadata.Title);
        Assert.Equal("Test Author", content.Metadata.Author);
        Assert.True(content.Metadata.WordCount > 0);
    }

    [Fact]
    public void ReadWithTable_ExtractsTableStructure()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "with-table.docx"));

        Assert.Single(content.Tables);
        var table = content.Tables[0];

        Assert.Equal(5, table.RowCount);
        Assert.Equal(4, table.ColumnCount);

        // Header row
        Assert.Equal("Characteristic", table.Rows[0].Cells[0].Text);
        Assert.Equal("Treatment (n=120)", table.Rows[0].Cells[1].Text);
        Assert.Equal("P-value", table.Rows[0].Cells[3].Text);

        // Data row
        Assert.Equal("Age, mean (SD)", table.Rows[1].Cells[0].Text);
        Assert.Equal("54.3 (12.1)", table.Rows[1].Cells[1].Text);

        // All rows have correct cell count
        Assert.All(table.Rows, row => Assert.Equal(4, row.Cells.Count));
    }

    [Fact]
    public void ReadWithComments_ExtractsComments()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "with-comments.docx"));

        // We expect at least 2 top-level comments
        Assert.True(content.Comments.Count >= 2, $"Expected at least 2 comments, got {content.Comments.Count}");

        // First comment anchored to "gold standard"
        var comment1 = content.Comments.First(c => c.CommentId == "1");
        Assert.Equal("Dr. Smith", comment1.Author);
        Assert.Contains("gold standard", comment1.AnchorText);
        Assert.Contains("Cochrane", comment1.Text);

        // Second comment
        var comment2 = content.Comments.First(c => c.CommentId == "2");
        Assert.Equal("Prof. Jones", comment2.Author);
        Assert.Contains("informed consent", comment2.AnchorText);
    }

    [Fact]
    public void ReadWithComments_ExtractsReplies()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "with-comments.docx"));

        // Comment 1 should have a reply
        var comment1 = content.Comments.First(c => c.CommentId == "1");
        Assert.Single(comment1.Replies);
        Assert.Equal("Dr. Lee", comment1.Replies[0].Author);
        Assert.Contains("Cochrane reference", comment1.Replies[0].Text);
        Assert.Equal("1", comment1.Replies[0].ReplyToCommentId);
    }

    [Fact]
    public void ReadWithTrackedChanges_DetectsInsertionsAndDeletions()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "with-tracked-changes.docx"));

        var insertions = content.TrackedChanges.Where(tc => tc.ChangeType == "insertion").ToList();
        var deletions = content.TrackedChanges.Where(tc => tc.ChangeType == "deletion").ToList();

        Assert.Equal(2, insertions.Count);
        Assert.Single(deletions);

        // Check insertion content
        Assert.Contains(insertions, i => i.Text.Contains("double-blind"));
        Assert.Contains(insertions, i => i.Author == "Dr. Smith");

        // Check deletion content
        Assert.Contains(deletions, d => d.Text.Contains("overall"));
        Assert.Contains(deletions, d => d.Author == "Prof. Jones");
    }

    [Fact]
    public void ReadWithCitations_DetectsZoteroFields()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "with-citations.docx"));

        Assert.True(content.CitationFields.Count >= 2, $"Expected at least 2 citations, got {content.CitationFields.Count}");

        var citations = content.CitationFields.Where(c => c.CitationType == "zotero").ToList();
        Assert.True(citations.Count >= 2);

        // Check citation details
        Assert.Contains(citations, c => c.RawFieldCode.Contains("smith2023"));
        Assert.Contains(citations, c => c.DisplayText.Contains("Smith"));
    }

    [Fact]
    public void ReadComplex_ExtractsEverything()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "complex.docx"));

        // Should have paragraphs
        Assert.True(content.Paragraphs.Count > 0);

        // Should have headings
        var headings = content.Paragraphs.Where(p => p.Type.StartsWith("heading")).ToList();
        Assert.True(headings.Count >= 2);

        // Should have tables
        Assert.True(content.Tables.Count >= 1);

        // Should have comments
        Assert.True(content.Comments.Count >= 1);

        // Should have tracked changes
        Assert.True(content.TrackedChanges.Count >= 1);

        // Should have citations
        Assert.True(content.CitationFields.Count >= 1);

        // Should have list items
        var listItems = content.Paragraphs.Where(p => p.Type == "bullet-list").ToList();
        Assert.True(listItems.Count >= 1);

        // Metadata should be populated
        Assert.NotNull(content.Metadata.Title);
    }

    [Fact]
    public void ReadSimple_ContentHashIsStable()
    {
        // Read the same file twice and verify hashes match
        var content1 = _reader.Read(Path.Combine(_fixtureDir, "simple.docx"));
        var content2 = _reader.Read(Path.Combine(_fixtureDir, "simple.docx"));

        for (int i = 0; i < content1.Paragraphs.Count; i++)
        {
            Assert.Equal(content1.Paragraphs[i].ContentHash, content2.Paragraphs[i].ContentHash);
        }
    }

    [Fact]
    public void ReadSimple_JsonSerializable()
    {
        var content = _reader.Read(Path.Combine(_fixtureDir, "simple.docx"));
        var json = System.Text.Json.JsonSerializer.Serialize(content, new System.Text.Json.JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
        });

        Assert.NotEmpty(json);
        Assert.Contains("paragraphs", json);
        Assert.Contains("metadata", json);
    }
}
