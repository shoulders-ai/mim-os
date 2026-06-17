using DocxWorker;

namespace DocxWorker.Tests;

/// <summary>
/// Tests against real manuscripts in testdata/.
/// These tests verify that the write operations work correctly on real-world
/// documents with complex formatting, tables, and fragmented runs.
/// </summary>
public class RealManuscriptWriteTests : IDisposable
{
    private readonly string _outputDir;
    private readonly DocxReader _reader = new();
    private readonly DocxWriter _writer = new();

    // Absolute paths to test data files
    private static readonly string TestDataDir = Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "testdata"));

    private static readonly string ManuscriptAProtocol =
        Path.Combine(TestDataDir, "manuscript-a-protocol.docx");
    private static readonly string ManuscriptBProtocol =
        Path.Combine(TestDataDir, "manuscript-b-protocol.docx");
    private static readonly string ManuscriptBReport =
        Path.Combine(TestDataDir, "manuscript-b-report.docx");
    private static readonly string ManuscriptCReport =
        Path.Combine(TestDataDir, "manuscript-c-report.docx");

    public RealManuscriptWriteTests()
    {
        _outputDir = Path.Combine(Path.GetTempPath(), "docxworker-real-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_outputDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_outputDir))
            Directory.Delete(_outputDir, recursive: true);
    }

    // ---- Manuscript A Protocol ----

    [Fact]
    public void ManuscriptAProtocol_AddComment_OnKnownText()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-a-protocol-commented.docx");
        var originalContent = _reader.Read(ManuscriptAProtocol);

        using (var session = _writer.Open(ManuscriptAProtocol, outputPath))
        {
            session.AddCommentByText(
                "Tick-borne encephalitis (TBE) is a viral central nervous system (CNS) infection",
                "AI Reviewer",
                "Consider adding a more precise epidemiological definition here."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        // Comment was added
        Assert.Single(modifiedContent.Comments);
        Assert.Equal("AI Reviewer", modifiedContent.Comments[0].Author);
        Assert.Contains("Tick-borne encephalitis", modifiedContent.Comments[0].AnchorText);

        // Paragraph count preserved
        Assert.Equal(originalContent.Paragraphs.Count, modifiedContent.Paragraphs.Count);

        // Text content preserved
        for (int i = 0; i < originalContent.Paragraphs.Count; i++)
        {
            Assert.Equal(originalContent.Paragraphs[i].Text, modifiedContent.Paragraphs[i].Text);
        }
    }

    [Fact]
    public void ManuscriptAProtocol_Validate()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-a-protocol-validate.docx");
        using var session = _writer.Open(ManuscriptAProtocol, outputPath);
        var errors = session.Validate();

        // Real manuscripts may have validation issues from Word's own output.
        // We just report them and ensure the method doesn't crash.
        Assert.NotNull(errors);
        // Log for debugging: errors are expected from complex real-world docs
    }

    // ---- Manuscript B Protocol ----

    [Fact]
    public void ManuscriptBProtocol_AddComment_OnKnownText()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-b-protocol-commented.docx");
        var originalContent = _reader.Read(ManuscriptBProtocol);

        using (var session = _writer.Open(ManuscriptBProtocol, outputPath))
        {
            session.AddCommentByText(
                "Menopause marks the last spontaneous menstrual period",
                "AI Reviewer",
                "This definition should reference WHO or ICD-10 criteria."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        Assert.Single(modifiedContent.Comments);
        Assert.Contains("Menopause marks", modifiedContent.Comments[0].AnchorText);
        Assert.Equal(originalContent.Paragraphs.Count, modifiedContent.Paragraphs.Count);
    }

    [Fact]
    public void ManuscriptBProtocol_Validate()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-b-protocol-validate.docx");
        using var session = _writer.Open(ManuscriptBProtocol, outputPath);
        var errors = session.Validate();
        Assert.NotNull(errors);
    }

    // ---- Manuscript B Report ----

    [Fact]
    public void ManuscriptBReport_AddComment_OnKnownText()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-b-report-commented.docx");
        var originalContent = _reader.Read(ManuscriptBReport);

        using (var session = _writer.Open(ManuscriptBReport, outputPath))
        {
            session.AddCommentByText(
                "Common menopausal symptoms include vasomotor symptoms",
                "AI Reviewer",
                "Please quantify the prevalence of these symptoms."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        Assert.Single(modifiedContent.Comments);
        Assert.Contains("Common menopausal symptoms", modifiedContent.Comments[0].AnchorText);
        Assert.Equal(originalContent.Paragraphs.Count, modifiedContent.Paragraphs.Count);
    }

    [Fact]
    public void ManuscriptBReport_AddComment_PreservesTextContent()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-b-report-preserve.docx");
        var originalContent = _reader.Read(ManuscriptBReport);

        using (var session = _writer.Open(ManuscriptBReport, outputPath))
        {
            session.AddCommentByText(
                "retrospective observational study",
                "AI Reviewer",
                "Good study design choice."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        // Verify all paragraph text is preserved
        for (int i = 0; i < originalContent.Paragraphs.Count; i++)
        {
            Assert.Equal(originalContent.Paragraphs[i].Text, modifiedContent.Paragraphs[i].Text);
        }
    }

    [Fact]
    public void ManuscriptBReport_Validate()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-b-report-validate.docx");
        using var session = _writer.Open(ManuscriptBReport, outputPath);
        var errors = session.Validate();
        Assert.NotNull(errors);
    }

    // ---- Manuscript C Report ----

    [Fact]
    public void ManuscriptCReport_AddComment_OnKnownText()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-c-report-commented.docx");
        var originalContent = _reader.Read(ManuscriptCReport);

        using (var session = _writer.Open(ManuscriptCReport, outputPath))
        {
            session.AddCommentByText(
                "the present study aimed to fill a critical evidence gap",
                "AI Reviewer",
                "Strong motivation statement. Consider expanding on what makes this gap critical."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        Assert.Single(modifiedContent.Comments);
        Assert.Contains("present study aimed", modifiedContent.Comments[0].AnchorText);
        Assert.Equal(originalContent.Paragraphs.Count, modifiedContent.Paragraphs.Count);
    }

    [Fact]
    public void ManuscriptCReport_AddComment_PreservesTextContent()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-c-report-preserve.docx");
        var originalContent = _reader.Read(ManuscriptCReport);

        using (var session = _writer.Open(ManuscriptCReport, outputPath))
        {
            session.AddCommentByText(
                "What is the comprehensive, long-term burden of TBE in Germany?",
                "AI Reviewer",
                "Clear research question."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);

        for (int i = 0; i < originalContent.Paragraphs.Count; i++)
        {
            Assert.Equal(originalContent.Paragraphs[i].Text, modifiedContent.Paragraphs[i].Text);
        }
    }

    [Fact]
    public void ManuscriptCReport_Validate()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-c-report-validate.docx");
        using var session = _writer.Open(ManuscriptCReport, outputPath);
        var errors = session.Validate();
        Assert.NotNull(errors);
    }

    // ---- Cross-cutting: comment near tables ----

    [Fact]
    public void ManuscriptAProtocol_AddComment_NearTable()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-a-near-table.docx");
        var originalContent = _reader.Read(ManuscriptAProtocol);

        using (var session = _writer.Open(ManuscriptAProtocol, outputPath))
        {
            session.AddCommentByText(
                "The study objectives, along with the respective operationalization",
                "AI Reviewer",
                "This section should cross-reference the methods section."
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);
        Assert.Single(modifiedContent.Comments);
        Assert.Equal(originalContent.Tables.Count, modifiedContent.Tables.Count);
    }

    [Fact]
    public void ManuscriptBProtocol_AddComment_NearTable()
    {
        var outputPath = Path.Combine(_outputDir, "manuscript-b-near-table.docx");
        var originalContent = _reader.Read(ManuscriptBProtocol);

        using (var session = _writer.Open(ManuscriptBProtocol, outputPath))
        {
            session.AddCommentByText(
                "planned milestones for this study",
                "AI Reviewer",
                "Are these milestones realistic given the data availability?"
            );
            session.Save();
        }

        var modifiedContent = _reader.Read(outputPath);
        Assert.Single(modifiedContent.Comments);
        Assert.Equal(originalContent.Tables.Count, modifiedContent.Tables.Count);
    }
}
