using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxWorker;

namespace DocxWorker.Tests;

public class TextSearcherTests : IDisposable
{
    private readonly string _outputDir;
    private readonly TextSearcher _searcher = new();

    public TextSearcherTests()
    {
        _outputDir = Path.Combine(Path.GetTempPath(), "docxworker-search-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_outputDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_outputDir))
            Directory.Delete(_outputDir, recursive: true);
    }

    // ---- Helper to create a body with paragraphs ----

    private Body CreateBody(params Paragraph[] paragraphs)
    {
        var body = new Body();
        foreach (var p in paragraphs)
            body.Append(p);
        return body;
    }

    private Paragraph CreateParagraph(string text)
    {
        return new Paragraph(new Run(new Text(text)));
    }

    private Paragraph CreateFragmentedParagraph(params string[] fragments)
    {
        var para = new Paragraph();
        foreach (var frag in fragments)
        {
            para.Append(new Run(new Text(frag) { Space = SpaceProcessingModeValues.Preserve }));
        }
        return para;
    }

    // ---- Tests ----

    [Fact]
    public void FindText_SimpleMatch()
    {
        var body = CreateBody(
            CreateParagraph("The quick brown fox jumps over the lazy dog.")
        );

        var result = _searcher.FindText(body, "brown fox");

        Assert.NotNull(result);
        Assert.Equal(0, result.ParagraphIndex);
        Assert.Equal(10, result.StartCharOffset);
        Assert.Equal(19, result.EndCharOffset);
        Assert.Equal("brown fox", result.FoundText);
    }

    [Fact]
    public void FindText_AcrossFragmentedRuns()
    {
        // "Observational Study Information is important" split across 4 runs
        var para = CreateFragmentedParagraph(
            "Observational Study",
            " ",
            "Information",
            " is important for research."
        );
        var body = CreateBody(para);

        var result = _searcher.FindText(body, "Study Information");

        Assert.NotNull(result);
        Assert.Equal(0, result.ParagraphIndex);
        Assert.Equal(14, result.StartCharOffset);  // "Study" starts at index 14
        Assert.Equal(31, result.EndCharOffset);     // Exclusive end after "Information"
        Assert.Equal("Study Information", result.FoundText);
    }

    [Fact]
    public void FindText_NotFound_ReturnsNull()
    {
        var body = CreateBody(
            CreateParagraph("Hello World")
        );

        var result = _searcher.FindText(body, "not here");

        Assert.Null(result);
    }

    [Fact]
    public void FindText_MultipleOccurrences_ReturnsFirst()
    {
        var body = CreateBody(
            CreateParagraph("The cat sat on the mat."),
            CreateParagraph("Another cat appeared.")
        );

        var result = _searcher.FindText(body, "cat");

        Assert.NotNull(result);
        Assert.Equal(0, result.ParagraphIndex); // First paragraph
        Assert.Equal(4, result.StartCharOffset);
    }

    [Fact]
    public void FindAllOccurrences_FindsAll()
    {
        var body = CreateBody(
            CreateParagraph("The cat sat on the mat."),
            CreateParagraph("Another cat appeared by the cat."),
            CreateParagraph("No felines here.")
        );

        var results = _searcher.FindAllOccurrences(body, "cat");

        Assert.Equal(3, results.Count);
        Assert.Equal(0, results[0].ParagraphIndex);
        Assert.Equal(1, results[1].ParagraphIndex);
        Assert.Equal(1, results[2].ParagraphIndex);
        // Second occurrence in paragraph 1 at "by the cat"
        Assert.True(results[2].StartCharOffset > results[1].StartCharOffset);
    }

    [Fact]
    public void FindTextNormalized_HandlesExtraSpaces()
    {
        var body = CreateBody(
            CreateParagraph("Randomized controlled trials are considered the gold standard for evaluating treatment effects.")
        );

        // Search with double space
        var result = _searcher.FindTextNormalized(body, "gold  standard");

        Assert.NotNull(result);
        Assert.Equal("gold standard", result.FoundText);
    }

    [Fact]
    public void FindText_InsideHyperlink()
    {
        var para = new Paragraph();
        para.Append(new Run(new Text("See the ") { Space = SpaceProcessingModeValues.Preserve }));
        var hyperlink = new Hyperlink();
        hyperlink.Append(new Run(new Text("official documentation") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(hyperlink);
        para.Append(new Run(new Text(" for details.") { Space = SpaceProcessingModeValues.Preserve }));
        var body = CreateBody(para);

        var result = _searcher.FindText(body, "official documentation");

        Assert.NotNull(result);
        Assert.Equal("official documentation", result.FoundText);
    }

    [Fact]
    public void FindText_InsideTableCell()
    {
        // TextSearcher.FindText only searches body-level paragraphs, not table cells
        var body = new Body();
        body.Append(CreateParagraph("Body paragraph text."));

        var table = new Table();
        var row = new TableRow();
        var cell = new TableCell(new Paragraph(new Run(new Text("Table cell text here."))));
        row.Append(cell);
        table.Append(row);
        body.Append(table);

        // Table-cell paragraphs ARE searched now (Descendants<Paragraph>()), so
        // comments can anchor inside results tables — critical for clinical review.
        var result = _searcher.FindText(body, "Table cell text");

        Assert.NotNull(result);
        Assert.Contains("Table cell text", result!.FoundText);
    }

    [Fact]
    public void FindText_SkipsFieldCodes()
    {
        // Paragraph with a Zotero field code
        var para = new Paragraph();
        para.Append(new Run(new Text("See ") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
        para.Append(new Run(new FieldCode(" ADDIN ZOTERO_ITEM CSL_CITATION {\"citationID\":\"abc\"} ") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
        para.Append(new Run(new Text("(Smith, 2023)") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
        para.Append(new Run(new Text(" for details.") { Space = SpaceProcessingModeValues.Preserve }));
        var body = CreateBody(para);

        // Field code content should NOT be searchable
        var codeResult = _searcher.FindText(body, "ZOTERO_ITEM");
        Assert.Null(codeResult);

        // Display text SHOULD be searchable
        var displayResult = _searcher.FindText(body, "(Smith, 2023)");
        Assert.NotNull(displayResult);

        // Full plain text should include display text but not field code
        var plainText = _searcher.GetParagraphPlainText(para);
        Assert.Contains("(Smith, 2023)", plainText);
        Assert.DoesNotContain("ZOTERO_ITEM", plainText);
    }

    [Fact]
    public void FindText_IncludesInsertedText()
    {
        var para = new Paragraph();
        para.Append(new Run(new Text("We conducted a ") { Space = SpaceProcessingModeValues.Preserve }));
        var ins = new InsertedRun { Author = "Dr. Smith", Date = DateTime.UtcNow, Id = "1" };
        ins.Append(new Run(new Text("double-blind ") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(ins);
        para.Append(new Run(new Text("randomized trial.") { Space = SpaceProcessingModeValues.Preserve }));
        var body = CreateBody(para);

        var result = _searcher.FindText(body, "double-blind");

        Assert.NotNull(result);
        Assert.Equal("double-blind", result.FoundText);
    }

    [Fact]
    public void FindText_ExcludesDeletedText()
    {
        var para = new Paragraph();
        para.Append(new Run(new Text("The primary endpoint was ") { Space = SpaceProcessingModeValues.Preserve }));
        var del = new DeletedRun { Author = "Prof. Jones", Date = DateTime.UtcNow, Id = "1" };
        del.Append(new Run(new DeletedText("overall ") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(del);
        para.Append(new Run(new Text("survival.") { Space = SpaceProcessingModeValues.Preserve }));
        var body = CreateBody(para);

        // "overall" should NOT be found
        var result = _searcher.FindText(body, "overall");
        Assert.Null(result);

        // But "was survival" should concatenate correctly
        var result2 = _searcher.FindText(body, "was survival");
        Assert.NotNull(result2);
    }

    [Fact]
    public void GetParagraphPlainText_ConcatenatesFragmentedRuns()
    {
        var para = CreateFragmentedParagraph("Hello", " ", "World", "!");

        var text = _searcher.GetParagraphPlainText(para);

        Assert.Equal("Hello World!", text);
    }

    [Fact]
    public void GetParagraphPlainText_HandlesHyperlinks()
    {
        var para = new Paragraph();
        para.Append(new Run(new Text("Click ") { Space = SpaceProcessingModeValues.Preserve }));
        var hyperlink = new Hyperlink();
        hyperlink.Append(new Run(new Text("here") { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(hyperlink);
        para.Append(new Run(new Text(" to continue.") { Space = SpaceProcessingModeValues.Preserve }));

        var text = _searcher.GetParagraphPlainText(para);

        Assert.Equal("Click here to continue.", text);
    }
}
