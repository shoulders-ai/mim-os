using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace DocxWorker;

/// <summary>
/// Programmatically creates test .docx files for use in unit tests.
/// </summary>
public static class TestFixtures
{
    public static void GenerateAll(string directory)
    {
        Directory.CreateDirectory(directory);
        CreateSimple(Path.Combine(directory, "simple.docx"));
        CreateWithComments(Path.Combine(directory, "with-comments.docx"));
        CreateWithTable(Path.Combine(directory, "with-table.docx"));
        CreateWithTrackedChanges(Path.Combine(directory, "with-tracked-changes.docx"));
        CreateWithCitations(Path.Combine(directory, "with-citations.docx"));
        CreateComplex(Path.Combine(directory, "complex.docx"));
    }

    /// <summary>
    /// 5 paragraphs of prose, one heading, one bullet list (3 items).
    /// </summary>
    public static void CreateSimple(string outputPath)
    {
        using var doc = WordprocessingDocument.Create(outputPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;

        AddStyleDefinitions(mainPart);
        SetDocumentProperties(doc, "Simple Test Document", "Test Author");

        // Heading
        body.Append(CreateHeadingParagraph("Introduction to Clinical Research", 1));

        // 5 paragraphs of prose
        body.Append(CreateParagraph("Clinical research is the cornerstone of evidence-based medicine. It encompasses a wide range of studies designed to evaluate the safety and efficacy of medical interventions, from pharmaceuticals to surgical procedures."));
        body.Append(CreateParagraph("Randomized controlled trials (RCTs) are considered the gold standard for evaluating treatment effects. In an RCT, participants are randomly assigned to either the treatment group or the control group, minimizing selection bias."));
        body.Append(CreateParagraph("Observational studies, while less rigorous than RCTs, provide valuable real-world evidence. Cohort studies follow groups of patients over time, while case-control studies compare patients with a condition to those without."));
        body.Append(CreateParagraph("The informed consent process is a fundamental ethical requirement in clinical research. Participants must be fully informed about the study procedures, potential risks, and expected benefits before agreeing to participate."));
        body.Append(CreateParagraph("Data management and statistical analysis are critical components of any clinical study. Proper data collection, cleaning, and analysis ensure the validity and reliability of study findings."));

        // Bullet list (3 items)
        body.Append(CreateListParagraph("Phase I trials assess safety and dosage in a small group of volunteers"));
        body.Append(CreateListParagraph("Phase II trials evaluate efficacy and side effects in a larger patient population"));
        body.Append(CreateListParagraph("Phase III trials confirm effectiveness and monitor adverse reactions in large-scale studies"));
    }

    /// <summary>
    /// Same as simple but with 2 existing comments and 1 reply.
    /// </summary>
    public static void CreateWithComments(string outputPath)
    {
        using var doc = WordprocessingDocument.Create(outputPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;

        AddStyleDefinitions(mainPart);
        SetDocumentProperties(doc, "Document With Comments", "Test Author");

        // Add comments part
        var commentsPart = mainPart.AddNewPart<WordprocessingCommentsPart>();
        commentsPart.Comments = new Comments();

        // Heading
        body.Append(CreateHeadingParagraph("Introduction to Clinical Research", 1));

        // Paragraph with comment anchored to "gold standard"
        var para1 = new Paragraph();
        var run1a = new Run(new Text("Randomized controlled trials are considered the ") { Space = SpaceProcessingModeValues.Preserve });
        var commentRangeStart1 = new CommentRangeStart { Id = "1" };
        var run1b = new Run(new Text("gold standard") { Space = SpaceProcessingModeValues.Preserve });
        var commentRangeEnd1 = new CommentRangeEnd { Id = "1" };
        var commentRef1 = new Run(new CommentReference { Id = "1" });
        var run1c = new Run(new Text(" for evaluating treatment effects.") { Space = SpaceProcessingModeValues.Preserve });
        para1.Append(run1a, commentRangeStart1, run1b, commentRangeEnd1, commentRef1, run1c);
        body.Append(para1);

        // More paragraphs
        body.Append(CreateParagraph("Observational studies provide valuable real-world evidence. Cohort studies follow groups of patients over time."));

        // Paragraph with comment spanning text
        var para3 = new Paragraph();
        var run3a = new Run(new Text("The ") { Space = SpaceProcessingModeValues.Preserve });
        var commentRangeStart2 = new CommentRangeStart { Id = "2" };
        var run3b = new Run(new Text("informed consent process is a fundamental ethical requirement") { Space = SpaceProcessingModeValues.Preserve });
        var commentRangeEnd2 = new CommentRangeEnd { Id = "2" };
        var commentRef2 = new Run(new CommentReference { Id = "2" });
        var run3c = new Run(new Text(" in clinical research.") { Space = SpaceProcessingModeValues.Preserve });
        para3.Append(run3a, commentRangeStart2, run3b, commentRangeEnd2, commentRef2, run3c);
        body.Append(para3);

        body.Append(CreateParagraph("Data management and statistical analysis are critical components of any clinical study."));

        // Create comment objects
        var comment1 = new Comment { Id = "1", Author = "Dr. Smith", Date = DateTime.Parse("2024-01-15T10:30:00Z") };
        comment1.Append(new Paragraph(new Run(new Text("Is this claim supported by the latest Cochrane review? Consider citing the 2023 meta-analysis."))));

        var comment2 = new Comment { Id = "2", Author = "Prof. Jones", Date = DateTime.Parse("2024-01-16T14:00:00Z") };
        comment2.Append(new Paragraph(new Run(new Text("This section should reference the Declaration of Helsinki and the Belmont Report."))));

        // Reply to comment 1
        var reply1 = new Comment { Id = "3", Author = "Dr. Lee", Date = DateTime.Parse("2024-01-17T09:15:00Z") };
        reply1.Append(new Paragraph(new Run(new Text("Agreed. I will add the Cochrane reference in the next revision."))));

        commentsPart.Comments.Append(comment1, comment2, reply1);

        // Add the extended comments part for reply threading
        var extPart = mainPart.AddNewPart<WordprocessingCommentsExPart>();
        // Use raw XML to set up the commentsEx with reply threading
        var extXml = @"<?xml version=""1.0"" encoding=""UTF-8"" standalone=""yes""?>
<w15:commentsEx xmlns:w15=""http://schemas.microsoft.com/office/word/2012/wordml""
                xmlns:mc=""http://schemas.openxmlformats.org/markup-compatibility/2006"">
  <w15:commentEx w15:paraId=""00000001"" w15:done=""0""/>
  <w15:commentEx w15:paraId=""00000002"" w15:done=""0""/>
  <w15:commentEx w15:paraId=""00000003"" w15:paraIdParent=""00000001"" w15:done=""0""/>
</w15:commentsEx>";
        using (var stream = extPart.GetStream(FileMode.Create))
        using (var writer = new StreamWriter(stream))
        {
            writer.Write(extXml);
        }
    }

    /// <summary>
    /// A document with a 4-column, 5-row table plus surrounding paragraphs.
    /// </summary>
    public static void CreateWithTable(string outputPath)
    {
        using var doc = WordprocessingDocument.Create(outputPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;

        AddStyleDefinitions(mainPart);
        SetDocumentProperties(doc, "Document With Table", "Test Author");

        body.Append(CreateHeadingParagraph("Baseline Characteristics", 1));
        body.Append(CreateParagraph("Table 1 shows the baseline characteristics of the study population."));

        // Create a 4-column, 5-row table
        var table = new Table();

        // Table properties
        var tblProps = new TableProperties(
            new TableBorders(
                new TopBorder { Val = BorderValues.Single, Size = 4 },
                new BottomBorder { Val = BorderValues.Single, Size = 4 },
                new LeftBorder { Val = BorderValues.Single, Size = 4 },
                new RightBorder { Val = BorderValues.Single, Size = 4 },
                new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4 },
                new InsideVerticalBorder { Val = BorderValues.Single, Size = 4 }
            )
        );
        table.Append(tblProps);

        // Header row
        string[][] data = {
            new[] { "Characteristic", "Treatment (n=120)", "Control (n=118)", "P-value" },
            new[] { "Age, mean (SD)", "54.3 (12.1)", "53.8 (11.9)", "0.74" },
            new[] { "Female sex, n (%)", "62 (51.7%)", "59 (50.0%)", "0.81" },
            new[] { "BMI, mean (SD)", "27.4 (4.2)", "27.1 (4.5)", "0.59" },
            new[] { "Diabetes, n (%)", "34 (28.3%)", "31 (26.3%)", "0.72" }
        };

        foreach (var rowData in data)
        {
            var row = new TableRow();
            foreach (var cellText in rowData)
            {
                var cell = new TableCell(new Paragraph(new Run(new Text(cellText))));
                row.Append(cell);
            }
            table.Append(row);
        }

        body.Append(table);
        body.Append(CreateParagraph("No significant differences were observed between groups at baseline."));
        body.Append(CreateParagraph("All participants provided written informed consent prior to enrollment."));
    }

    /// <summary>
    /// A document with 2 tracked insertions and 1 tracked deletion.
    /// </summary>
    public static void CreateWithTrackedChanges(string outputPath)
    {
        using var doc = WordprocessingDocument.Create(outputPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;

        AddStyleDefinitions(mainPart);
        SetDocumentProperties(doc, "Document With Tracked Changes", "Test Author");

        body.Append(CreateHeadingParagraph("Methods", 1));

        // Paragraph with a tracked insertion
        var para1 = new Paragraph();
        para1.Append(new Run(new Text("We conducted a ") { Space = SpaceProcessingModeValues.Preserve }));
        var ins1 = new InsertedRun
        {
            Author = "Dr. Smith",
            Date = DateTime.Parse("2024-02-01T10:00:00Z"),
            Id = "1"
        };
        ins1.Append(new Run(new Text("double-blind ") { Space = SpaceProcessingModeValues.Preserve }));
        para1.Append(ins1);
        para1.Append(new Run(new Text("randomized controlled trial.") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(para1);

        // Normal paragraph
        body.Append(CreateParagraph("Participants were recruited from three tertiary care hospitals between January and December 2023."));

        // Paragraph with a tracked deletion
        var para3 = new Paragraph();
        para3.Append(new Run(new Text("The primary endpoint was ") { Space = SpaceProcessingModeValues.Preserve }));
        var del1 = new DeletedRun
        {
            Author = "Prof. Jones",
            Date = DateTime.Parse("2024-02-02T15:30:00Z"),
            Id = "2"
        };
        del1.Append(new Run(new DeletedText("overall ") { Space = SpaceProcessingModeValues.Preserve }));
        para3.Append(del1);
        para3.Append(new Run(new Text("progression-free survival at 12 months.") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(para3);

        // Another paragraph with a tracked insertion
        var para4 = new Paragraph();
        para4.Append(new Run(new Text("Secondary endpoints included quality of life") { Space = SpaceProcessingModeValues.Preserve }));
        var ins2 = new InsertedRun
        {
            Author = "Dr. Smith",
            Date = DateTime.Parse("2024-02-03T11:00:00Z"),
            Id = "3"
        };
        ins2.Append(new Run(new Text(", adverse events, and treatment adherence") { Space = SpaceProcessingModeValues.Preserve }));
        para4.Append(ins2);
        para4.Append(new Run(new Text(".") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(para4);
    }

    /// <summary>
    /// A document with fake Zotero-style field codes and a bibliography.
    /// </summary>
    public static void CreateWithCitations(string outputPath)
    {
        using var doc = WordprocessingDocument.Create(outputPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;

        AddStyleDefinitions(mainPart);
        SetDocumentProperties(doc, "Document With Citations", "Test Author");

        body.Append(CreateHeadingParagraph("Literature Review", 1));

        // Paragraph with Zotero citation field
        var para1 = new Paragraph();
        para1.Append(new Run(new Text("Previous studies have shown significant improvements in patient outcomes ") { Space = SpaceProcessingModeValues.Preserve }));
        // Field code for Zotero citation
        para1.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
        para1.Append(new Run(new FieldCode(" ADDIN ZOTERO_ITEM CSL_CITATION {\"citationID\":\"abc123\",\"properties\":{},\"citationItems\":[{\"id\":\"smith2023\",\"itemData\":{\"author\":[{\"family\":\"Smith\",\"given\":\"J.\"}],\"title\":\"Outcomes in RCTs\",\"issued\":{\"date-parts\":[[2023]]}}}]} ") { Space = SpaceProcessingModeValues.Preserve }));
        para1.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
        para1.Append(new Run(new Text("(Smith, 2023)") { Space = SpaceProcessingModeValues.Preserve }));
        para1.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
        para1.Append(new Run(new Text(".") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(para1);

        body.Append(CreateParagraph("The meta-analysis pooled data from 15 randomized controlled trials involving 3,420 participants across multiple countries."));

        // Another paragraph with citation
        var para3 = new Paragraph();
        para3.Append(new Run(new Text("A systematic review of the literature ") { Space = SpaceProcessingModeValues.Preserve }));
        para3.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
        para3.Append(new Run(new FieldCode(" ADDIN ZOTERO_ITEM CSL_CITATION {\"citationID\":\"def456\",\"properties\":{},\"citationItems\":[{\"id\":\"jones2022\",\"itemData\":{\"author\":[{\"family\":\"Jones\",\"given\":\"A.\"}],\"title\":\"Systematic Reviews in Medicine\",\"issued\":{\"date-parts\":[[2022]]}}}]} ") { Space = SpaceProcessingModeValues.Preserve }));
        para3.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
        para3.Append(new Run(new Text("(Jones, 2022)") { Space = SpaceProcessingModeValues.Preserve }));
        para3.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
        para3.Append(new Run(new Text(" confirmed these findings.") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(para3);

        // Bibliography heading and entries
        body.Append(CreateHeadingParagraph("Bibliography", 1));

        var bibPara1 = new Paragraph();
        bibPara1.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
        bibPara1.Append(new Run(new FieldCode(" ADDIN ZOTERO_BIBL {\"uncited\":[],\"omitted\":[],\"custom\":[]} CSL_BIBLIOGRAPHY ") { Space = SpaceProcessingModeValues.Preserve }));
        bibPara1.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
        bibPara1.Append(new Run(new Text("Smith, J. (2023). Outcomes in RCTs. Journal of Clinical Medicine, 45(2), 112-128.")));
        body.Append(bibPara1);

        var bibPara2 = new Paragraph();
        bibPara2.Append(new Run(new Text("Jones, A. (2022). Systematic Reviews in Medicine. Medical Research Reviews, 31(4), 445-462.")));
        bibPara2.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
        body.Append(bibPara2);
    }

    /// <summary>
    /// Complex document combining heading, paragraphs, table, comments, tracked changes, and citations.
    /// </summary>
    public static void CreateComplex(string outputPath)
    {
        using var doc = WordprocessingDocument.Create(outputPath, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        var body = mainPart.Document.Body!;

        AddStyleDefinitions(mainPart);
        SetDocumentProperties(doc, "Complex Clinical Trial Report", "Dr. Research Team");

        // Comments part
        var commentsPart = mainPart.AddNewPart<WordprocessingCommentsPart>();
        commentsPart.Comments = new Comments();

        // --- Title ---
        body.Append(CreateHeadingParagraph("Efficacy of Novel Treatment in Advanced Disease: A Randomized Controlled Trial", 1));

        // --- Abstract paragraph ---
        body.Append(CreateParagraph("Background: Current treatments for advanced disease remain inadequate, with response rates below 30%. This trial evaluated a novel targeted therapy in combination with standard of care."));

        // --- Methods section with tracked insertion ---
        body.Append(CreateHeadingParagraph("Methods", 2));

        var methodsPara = new Paragraph();
        methodsPara.Append(new Run(new Text("We conducted a ") { Space = SpaceProcessingModeValues.Preserve }));
        var ins1 = new InsertedRun { Author = "Dr. Smith", Date = DateTime.Parse("2024-03-01T10:00:00Z"), Id = "101" };
        ins1.Append(new Run(new Text("multicenter, ") { Space = SpaceProcessingModeValues.Preserve }));
        methodsPara.Append(ins1);
        methodsPara.Append(new Run(new Text("double-blind, placebo-controlled trial.") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(methodsPara);

        // Paragraph with comment and citation
        var resultsPara = new Paragraph();
        resultsPara.Append(new Run(new Text("Previous work ") { Space = SpaceProcessingModeValues.Preserve }));
        resultsPara.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }));
        resultsPara.Append(new Run(new FieldCode(" ADDIN ZOTERO_ITEM CSL_CITATION {\"citationID\":\"xyz789\",\"citationItems\":[{\"id\":\"lee2023\"}]} ") { Space = SpaceProcessingModeValues.Preserve }));
        resultsPara.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.Separate }));
        resultsPara.Append(new Run(new Text("(Lee et al., 2023)") { Space = SpaceProcessingModeValues.Preserve }));
        resultsPara.Append(new Run(new FieldChar { FieldCharType = FieldCharValues.End }));
        resultsPara.Append(new Run(new Text(" established the baseline.") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(resultsPara);

        // --- Results heading ---
        body.Append(CreateHeadingParagraph("Results", 2));

        // Paragraph with comment
        var findingsPara = new Paragraph();
        var commentRangeStart = new CommentRangeStart { Id = "1" };
        var run_f1 = new Run(new Text("The treatment group showed a statistically significant improvement") { Space = SpaceProcessingModeValues.Preserve });
        var commentRangeEnd = new CommentRangeEnd { Id = "1" };
        var commentRefRun = new Run(new CommentReference { Id = "1" });
        var run_f2 = new Run(new Text(" in the primary endpoint (HR 0.65, 95% CI 0.52-0.81, p<0.001).") { Space = SpaceProcessingModeValues.Preserve });
        findingsPara.Append(commentRangeStart, run_f1, commentRangeEnd, commentRefRun, run_f2);
        body.Append(findingsPara);

        // Table
        body.Append(CreateParagraph("Table 1 summarizes the primary and secondary endpoints."));

        var table = new Table();
        var tblProps = new TableProperties(
            new TableBorders(
                new TopBorder { Val = BorderValues.Single, Size = 4 },
                new BottomBorder { Val = BorderValues.Single, Size = 4 },
                new LeftBorder { Val = BorderValues.Single, Size = 4 },
                new RightBorder { Val = BorderValues.Single, Size = 4 },
                new InsideHorizontalBorder { Val = BorderValues.Single, Size = 4 },
                new InsideVerticalBorder { Val = BorderValues.Single, Size = 4 }
            )
        );
        table.Append(tblProps);
        string[][] tableData = {
            new[] { "Endpoint", "Treatment", "Control", "P-value" },
            new[] { "PFS (months)", "8.4", "5.2", "<0.001" },
            new[] { "OS (months)", "14.2", "11.8", "0.04" },
        };
        foreach (var rowData in tableData)
        {
            var row = new TableRow();
            foreach (var cellText in rowData)
            {
                row.Append(new TableCell(new Paragraph(new Run(new Text(cellText)))));
            }
            table.Append(row);
        }
        body.Append(table);

        // Paragraph with tracked deletion
        var safetyPara = new Paragraph();
        safetyPara.Append(new Run(new Text("Adverse events were ") { Space = SpaceProcessingModeValues.Preserve }));
        var del1 = new DeletedRun { Author = "Prof. Jones", Date = DateTime.Parse("2024-03-02T15:30:00Z"), Id = "102" };
        del1.Append(new Run(new DeletedText("generally ") { Space = SpaceProcessingModeValues.Preserve }));
        safetyPara.Append(del1);
        safetyPara.Append(new Run(new Text("mild to moderate in severity.") { Space = SpaceProcessingModeValues.Preserve }));
        body.Append(safetyPara);

        // Bullet list
        body.Append(CreateListParagraph("Grade 3-4 neutropenia occurred in 12% of treatment patients"));
        body.Append(CreateListParagraph("No treatment-related deaths were reported"));
        body.Append(CreateListParagraph("Quality of life scores were maintained throughout the study"));

        // Comment
        var comment1 = new Comment { Id = "1", Author = "Reviewer 1", Date = DateTime.Parse("2024-03-15T09:00:00Z") };
        comment1.Append(new Paragraph(new Run(new Text("Please provide the absolute risk reduction and number needed to treat."))));
        commentsPart.Comments.Append(comment1);
    }

    // ---- Helper methods ----

    private static void AddStyleDefinitions(MainDocumentPart mainPart)
    {
        var stylesPart = mainPart.AddNewPart<StyleDefinitionsPart>();
        var styles = new Styles();

        // Heading1
        var heading1 = new Style { Type = StyleValues.Paragraph, StyleId = "Heading1" };
        heading1.Append(new StyleName { Val = "heading 1" });
        heading1.Append(new StyleParagraphProperties(new OutlineLevel { Val = 0 }));
        styles.Append(heading1);

        // Heading2
        var heading2 = new Style { Type = StyleValues.Paragraph, StyleId = "Heading2" };
        heading2.Append(new StyleName { Val = "heading 2" });
        heading2.Append(new StyleParagraphProperties(new OutlineLevel { Val = 1 }));
        styles.Append(heading2);

        // ListParagraph
        var listStyle = new Style { Type = StyleValues.Paragraph, StyleId = "ListParagraph" };
        listStyle.Append(new StyleName { Val = "List Paragraph" });
        styles.Append(listStyle);

        // Normal
        var normal = new Style { Type = StyleValues.Paragraph, StyleId = "Normal", Default = true };
        normal.Append(new StyleName { Val = "Normal" });
        styles.Append(normal);

        stylesPart.Styles = styles;
    }

    private static void SetDocumentProperties(WordprocessingDocument doc, string title, string author)
    {
        doc.PackageProperties.Title = title;
        doc.PackageProperties.Creator = author;
        doc.PackageProperties.Created = DateTime.Parse("2024-01-01T00:00:00Z");
        doc.PackageProperties.Modified = DateTime.Parse("2024-03-15T00:00:00Z");
    }

    private static Paragraph CreateHeadingParagraph(string text, int level)
    {
        var para = new Paragraph();
        var pProps = new ParagraphProperties { ParagraphStyleId = new ParagraphStyleId { Val = $"Heading{level}" } };
        para.Append(pProps);
        para.Append(new Run(new Text(text)));
        return para;
    }

    private static Paragraph CreateParagraph(string text)
    {
        return new Paragraph(new Run(new Text(text)));
    }

    private static Paragraph CreateListParagraph(string text)
    {
        var para = new Paragraph();
        var pProps = new ParagraphProperties
        {
            ParagraphStyleId = new ParagraphStyleId { Val = "ListParagraph" },
            NumberingProperties = new NumberingProperties(
                new NumberingLevelReference { Val = 0 },
                new NumberingId { Val = 1 }
            )
        };
        para.Append(pProps);
        para.Append(new Run(new Text(text)));
        return para;
    }
}
