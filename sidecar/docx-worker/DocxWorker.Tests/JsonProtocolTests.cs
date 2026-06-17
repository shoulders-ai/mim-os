using System.Text.Json;
using System.Text.Json.Serialization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocxWorker;

namespace DocxWorker.Tests;

/// <summary>
/// Tests for the --json protocol mode.
/// Each test writes a JSON request to a temp file, calls Program.Main,
/// captures stdout, and verifies the JSON response.
/// </summary>
public class JsonProtocolTests : IDisposable
{
    private readonly string _tempDir;
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public JsonProtocolTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "docxworker-json-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
            Directory.Delete(_tempDir, recursive: true);
    }

    // ---- Helpers ----

    private string CreateSimpleDocx(string name, params string[] paragraphs)
    {
        var path = Path.Combine(_tempDir, name);
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

    private string WriteJsonRequest(string name, object request)
    {
        var path = Path.Combine(_tempDir, name);
        File.WriteAllText(path, JsonSerializer.Serialize(request, JsonOpts));
        return path;
    }

    private JsonResponse RunJsonProtocol(string requestPath)
    {
        var originalOut = Console.Out;
        using var sw = new StringWriter();
        Console.SetOut(sw);
        try
        {
            Program.Main(new[] { "--json", requestPath });
        }
        finally
        {
            Console.SetOut(originalOut);
        }

        var output = sw.ToString().Trim();
        var response = JsonSerializer.Deserialize<JsonResponse>(output, JsonOpts);
        Assert.NotNull(response);
        return response!;
    }

    // ---- Tests ----

    [Fact]
    public void Annotate_AddComment_ReturnsSuccessResult()
    {
        var inputDocx = CreateSimpleDocx("add-comment.docx",
            "The gold standard for treatment is well established.");
        var outputDocx = Path.Combine(_tempDir, "add-comment-out.docx");

        var request = new JsonRequest
        {
            Command = "annotate",
            InputPath = inputDocx,
            OutputPath = outputDocx,
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "gold standard", Author = "test", CommentText = "Needs citation" }
            }
        };

        var requestPath = WriteJsonRequest("add-comment-req.json", request);
        var response = RunJsonProtocol(requestPath);

        Assert.True(response.Success);
        Assert.NotNull(response.Results);
        Assert.Single(response.Results!);
        Assert.True(response.Results![0].Success);
        Assert.False(string.IsNullOrEmpty(response.Results[0].CommentId));
        Assert.Equal(outputDocx, response.OutputPath);
        Assert.NotNull(response.Summary);
        Assert.Equal(1, response.Summary!.Total);
        Assert.Equal(1, response.Summary.Succeeded);
        Assert.Equal(0, response.Summary.Failed);
    }

    [Fact]
    public void Annotate_AllOperationTypes_BatchSuccess()
    {
        var inputDocx = CreateSimpleDocx("all-ops.docx",
            "The study included 500 participants from three clinical sites.",
            "Results showed significant improvement in the treatment group.");
        var setupOutputDocx = Path.Combine(_tempDir, "all-ops-setup-out.docx");
        var batchOutputDocx = Path.Combine(_tempDir, "all-ops-batch-out.docx");

        // First: add a comment so we can reply to it and resolve it
        var setupRequest = new JsonRequest
        {
            Command = "annotate",
            InputPath = inputDocx,
            OutputPath = setupOutputDocx,
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "500 participants", Author = "setup", CommentText = "Setup comment" }
            }
        };
        var setupPath = WriteJsonRequest("all-ops-setup.json", setupRequest);
        var setupResponse = RunJsonProtocol(setupPath);
        Assert.True(setupResponse.Success);
        var parentCommentId = setupResponse.Results![0].CommentId!;

        // Now run all 5 operation types in a single batch using the setup output as input
        var batchRequest = new JsonRequest
        {
            Command = "annotate",
            InputPath = setupOutputDocx,
            OutputPath = batchOutputDocx,
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "significant improvement", Author = "dr-a", CommentText = "Good finding" },
                new() { Type = "reply_comment", ParentCommentId = parentCommentId, Author = "dr-b", ReplyText = "Confirmed" },
                new() { Type = "resolve_comment", CommentId = parentCommentId },
                new() { Type = "tracked_insertion", AnchorText = "treatment group", InsertionText = " (n=250)", Position = "after", Author = "dr-c" },
                new() { Type = "tracked_deletion", DeleteText = "three clinical sites", Author = "dr-d" }
            }
        };
        var batchPath = WriteJsonRequest("all-ops-batch.json", batchRequest);
        var batchResponse = RunJsonProtocol(batchPath);

        Assert.True(batchResponse.Success);
        Assert.NotNull(batchResponse.Results);
        Assert.Equal(5, batchResponse.Results!.Count);
        Assert.All(batchResponse.Results, r => Assert.True(r.Success, $"Operation {r.Index} failed: {r.Error}"));
        Assert.Equal(5, batchResponse.Summary!.Total);
        Assert.Equal(5, batchResponse.Summary.Succeeded);
        Assert.Equal(0, batchResponse.Summary.Failed);
    }

    [Fact]
    public void Annotate_TextNotFound_PerOperationFailureNotGlobal()
    {
        var inputDocx = CreateSimpleDocx("partial-fail.docx",
            "The gold standard for treatment is well established.");
        var outputDocx = Path.Combine(_tempDir, "partial-fail-out.docx");

        var request = new JsonRequest
        {
            Command = "annotate",
            InputPath = inputDocx,
            OutputPath = outputDocx,
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "gold standard", Author = "test", CommentText = "This succeeds" },
                new() { Type = "add_comment", AnchorText = "NONEXISTENT TEXT THAT DOES NOT APPEAR", Author = "test", CommentText = "This fails" },
                new() { Type = "add_comment", AnchorText = "well established", Author = "test", CommentText = "This also succeeds" }
            }
        };

        var requestPath = WriteJsonRequest("partial-fail-req.json", request);
        var response = RunJsonProtocol(requestPath);

        // Overall success is false because one operation failed
        Assert.False(response.Success);
        Assert.NotNull(response.Results);
        Assert.Equal(3, response.Results!.Count);

        // First and third succeed
        Assert.True(response.Results[0].Success);
        Assert.False(string.IsNullOrEmpty(response.Results[0].CommentId));

        // Second fails with a meaningful error
        Assert.False(response.Results[1].Success);
        Assert.NotNull(response.Results[1].Error);
        Assert.Contains("not found", response.Results[1].Error!, StringComparison.OrdinalIgnoreCase);

        // Third still succeeds
        Assert.True(response.Results[2].Success);
        Assert.False(string.IsNullOrEmpty(response.Results[2].CommentId));

        // Summary reflects 2 succeeded, 1 failed
        Assert.Equal(3, response.Summary!.Total);
        Assert.Equal(2, response.Summary.Succeeded);
        Assert.Equal(1, response.Summary.Failed);

        // Output file was still created
        Assert.True(File.Exists(outputDocx));
    }

    [Fact]
    public void ReadComments_ReturnsParsedComments()
    {
        // First create a document with comments via the annotate command
        var inputDocx = CreateSimpleDocx("read-setup.docx",
            "Clinical research is the cornerstone of evidence-based medicine.");
        var annotatedDocx = Path.Combine(_tempDir, "read-annotated.docx");

        var annotateReq = new JsonRequest
        {
            Command = "annotate",
            InputPath = inputDocx,
            OutputPath = annotatedDocx,
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "cornerstone", Author = "reviewer-1", CommentText = "Strong word choice" }
            }
        };
        var annotatePath = WriteJsonRequest("read-setup-req.json", annotateReq);
        var annotateResponse = RunJsonProtocol(annotatePath);
        Assert.True(annotateResponse.Success);

        // Now read comments
        var readReq = new JsonRequest
        {
            Command = "read_comments",
            InputPath = annotatedDocx
        };
        var readPath = WriteJsonRequest("read-comments-req.json", readReq);
        var readResponse = RunJsonProtocol(readPath);

        Assert.True(readResponse.Success);
        Assert.NotNull(readResponse.Comments);
        Assert.Single(readResponse.Comments!);
        Assert.Equal("reviewer-1", readResponse.Comments[0].Author);
        Assert.Equal("cornerstone", readResponse.Comments[0].AnchorText);
        Assert.Contains("Strong word choice", readResponse.Comments[0].Text);
        Assert.NotNull(readResponse.Metadata);
    }

    [Fact]
    public void Validate_ValidDocument_NoErrors()
    {
        var inputDocx = CreateSimpleDocx("validate-clean.docx",
            "A simple valid document with clean structure.");

        var request = new JsonRequest
        {
            Command = "validate",
            InputPath = inputDocx
        };

        var requestPath = WriteJsonRequest("validate-req.json", request);
        var response = RunJsonProtocol(requestPath);

        Assert.True(response.Success);
        // Errors should be null (no errors) or an empty list
        Assert.True(response.Errors == null || response.Errors.Count == 0);
    }

    [Fact]
    public void MissingInputFile_ReturnsErrorJson()
    {
        var request = new JsonRequest
        {
            Command = "annotate",
            InputPath = Path.Combine(_tempDir, "does-not-exist.docx"),
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "text", Author = "test", CommentText = "comment" }
            }
        };

        var requestPath = WriteJsonRequest("missing-input-req.json", request);
        var response = RunJsonProtocol(requestPath);

        Assert.False(response.Success);
        Assert.NotNull(response.Error);
        Assert.Contains("not found", response.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void InvalidJson_ReturnsErrorJson()
    {
        var garbagePath = Path.Combine(_tempDir, "garbage.json");
        File.WriteAllText(garbagePath, "this is not valid json {{{");

        var originalOut = Console.Out;
        using var sw = new StringWriter();
        Console.SetOut(sw);
        try
        {
            Program.Main(new[] { "--json", garbagePath });
        }
        finally
        {
            Console.SetOut(originalOut);
        }

        var output = sw.ToString().Trim();
        var response = JsonSerializer.Deserialize<JsonResponse>(output, JsonOpts);
        Assert.NotNull(response);
        Assert.False(response!.Success);
        Assert.NotNull(response.Error);
    }

    [Fact]
    public void RoundTrip_AnnotateThenReadComments()
    {
        var inputDocx = CreateSimpleDocx("roundtrip.docx",
            "The study population consisted of 200 healthy volunteers.",
            "Outcomes were measured at baseline and 12 months.");
        var outputDocx = Path.Combine(_tempDir, "roundtrip-out.docx");

        // Step 1: annotate with two comments
        var annotateReq = new JsonRequest
        {
            Command = "annotate",
            InputPath = inputDocx,
            OutputPath = outputDocx,
            Operations = new List<JsonOperation>
            {
                new() { Type = "add_comment", AnchorText = "200 healthy volunteers", Author = "dr-a", CommentText = "Sample size justification?" },
                new() { Type = "add_comment", AnchorText = "12 months", Author = "dr-b", CommentText = "Follow-up period adequate?" }
            }
        };
        var annotatePath = WriteJsonRequest("roundtrip-annotate.json", annotateReq);
        var annotateResponse = RunJsonProtocol(annotatePath);

        Assert.True(annotateResponse.Success);
        Assert.Equal(2, annotateResponse.Summary!.Succeeded);

        var commentId1 = annotateResponse.Results![0].CommentId!;
        var commentId2 = annotateResponse.Results[1].CommentId!;

        // Step 2: read comments back from the output
        var readReq = new JsonRequest
        {
            Command = "read_comments",
            InputPath = outputDocx
        };
        var readPath = WriteJsonRequest("roundtrip-read.json", readReq);
        var readResponse = RunJsonProtocol(readPath);

        Assert.True(readResponse.Success);
        Assert.NotNull(readResponse.Comments);
        Assert.Equal(2, readResponse.Comments!.Count);

        // Verify comments are round-tripped correctly
        var anchors = readResponse.Comments.Select(c => c.AnchorText).ToList();
        Assert.Contains(anchors, a => a.Contains("200 healthy volunteers"));
        Assert.Contains(anchors, a => a.Contains("12 months"));

        var authors = readResponse.Comments.Select(c => c.Author).ToList();
        Assert.Contains("dr-a", authors);
        Assert.Contains("dr-b", authors);

        // Verify comment text content
        var texts = readResponse.Comments.Select(c => c.Text).ToList();
        Assert.Contains(texts, t => t.Contains("Sample size justification"));
        Assert.Contains(texts, t => t.Contains("Follow-up period adequate"));
    }
}
