using System.Text.Json;
using System.Text.Json.Serialization;
using DocxWorker;

public class Program
{
    private static readonly JsonSerializerOptions jsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly JsonSerializerOptions jsonCompactOptions = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            PrintUsage();
            return 1;
        }

        var command = args[0].ToLowerInvariant();

        // JSON protocol mode — must be checked before legacy CLI dispatch
        if (command == "--json")
        {
            if (args.Length < 2)
            {
                var errorResponse = new JsonResponse { Success = false, Error = "Usage: --json <request-file>" };
                Console.WriteLine(JsonSerializer.Serialize(errorResponse, jsonCompactOptions));
                return 1;
            }
            return HandleJsonRequest(args[1]);
        }

        switch (command)
        {
            case "read":
                if (args.Length < 2) { Console.Error.WriteLine("Usage: read <input.docx>"); return 1; }
                return ReadDocument(args[1]);

            case "add-comment":
                if (args.Length < 8)
                {
                    Console.Error.WriteLine("Usage: add-comment <input.docx> <output.docx> <paragraph-index> <start> <end> <author> <text>");
                    return 1;
                }
                return AddComment(args[1], args[2], int.Parse(args[3]), int.Parse(args[4]), int.Parse(args[5]), args[6], args[7]);

            case "add-comment-text":
                if (args.Length < 6)
                {
                    Console.Error.WriteLine("Usage: add-comment-text <input.docx> <output.docx> <anchor-text> <author> <comment-text>");
                    return 1;
                }
                return AddCommentByText(args[1], args[2], args[3], args[4], args[5]);

            case "reply":
                if (args.Length < 6)
                {
                    Console.Error.WriteLine("Usage: reply <input.docx> <output.docx> <comment-id> <author> <reply-text>");
                    return 1;
                }
                return AddReply(args[1], args[2], args[3], args[4], args[5]);

            case "validate":
                if (args.Length < 2) { Console.Error.WriteLine("Usage: validate <file.docx>"); return 1; }
                return ValidateDocument(args[1]);

            case "generate-fixtures":
                if (args.Length < 2) { Console.Error.WriteLine("Usage: generate-fixtures <output-dir>"); return 1; }
                return GenerateFixtures(args[1]);

            default:
                Console.Error.WriteLine($"Unknown command: {command}");
                PrintUsage();
                return 1;
        }
    }

    // ---- JSON protocol handler ----

    static int HandleJsonRequest(string requestFilePath)
    {
        JsonResponse response;
        try
        {
            if (!File.Exists(requestFilePath))
            {
                response = new JsonResponse { Success = false, Error = $"Request file not found: {requestFilePath}" };
                Console.WriteLine(JsonSerializer.Serialize(response, jsonCompactOptions));
                return 1;
            }

            var jsonText = File.ReadAllText(requestFilePath);
            var request = JsonSerializer.Deserialize<JsonRequest>(jsonText, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            if (request == null)
            {
                response = new JsonResponse { Success = false, Error = "Failed to parse JSON request" };
                Console.WriteLine(JsonSerializer.Serialize(response, jsonCompactOptions));
                return 1;
            }

            switch (request.Command.ToLowerInvariant())
            {
                case "annotate":
                    response = HandleAnnotate(request);
                    break;
                case "read_comments":
                    response = HandleReadComments(request);
                    break;
                case "validate":
                    response = HandleValidate(request);
                    break;
                default:
                    response = new JsonResponse { Success = false, Error = $"Unknown command: {request.Command}" };
                    break;
            }
        }
        catch (Exception ex)
        {
            response = new JsonResponse { Success = false, Error = ex.Message };
        }

        Console.WriteLine(JsonSerializer.Serialize(response, jsonCompactOptions));
        return response.Success ? 0 : 1;
    }

    static JsonResponse HandleAnnotate(JsonRequest request)
    {
        if (string.IsNullOrEmpty(request.InputPath))
            return new JsonResponse { Success = false, Error = "inputPath is required" };

        if (!File.Exists(request.InputPath))
            return new JsonResponse { Success = false, Error = $"Input file not found: {request.InputPath}" };

        var outputPath = request.OutputPath;
        if (string.IsNullOrEmpty(outputPath))
        {
            var dir = Path.GetDirectoryName(request.InputPath) ?? Path.GetTempPath();
            var name = Path.GetFileNameWithoutExtension(request.InputPath);
            var ext = Path.GetExtension(request.InputPath);
            outputPath = Path.Combine(dir, $"{name}-annotated{ext}");
        }

        // DocxWriter.Open copies input to output internally
        var writer = new DocxWriter();
        using var session = writer.Open(request.InputPath, outputPath);

        var operations = request.Operations ?? new List<JsonOperation>();
        var results = new List<JsonOperationResult>();
        int succeeded = 0;
        int failed = 0;

        for (int i = 0; i < operations.Count; i++)
        {
            var op = operations[i];
            var opResult = new JsonOperationResult { Index = i };

            try
            {
                switch (op.Type.ToLowerInvariant())
                {
                    case "add_comment":
                    {
                        var cr = session.AddCommentByTextWithResult(
                            op.AnchorText ?? throw new ArgumentException("anchorText is required"),
                            op.Author ?? "dyad",
                            op.CommentText ?? throw new ArgumentException("commentText is required"),
                            op.OccurrenceIndex ?? 0);
                        opResult.Success = true;
                        opResult.CommentId = cr.CommentId;
                        opResult.UsedNormalizedMatch = cr.UsedNormalizedMatch ? true : null;
                        opResult.MatchedText = cr.MatchedText;
                        succeeded++;
                        break;
                    }
                    case "reply_comment":
                    {
                        var replyId = session.AddCommentReply(
                            op.ParentCommentId ?? throw new ArgumentException("parentCommentId is required"),
                            op.Author ?? "dyad",
                            op.ReplyText ?? throw new ArgumentException("replyText is required"));
                        opResult.Success = true;
                        opResult.CommentId = replyId;
                        succeeded++;
                        break;
                    }
                    case "resolve_comment":
                    {
                        session.ResolveComment(
                            op.CommentId ?? throw new ArgumentException("commentId is required"));
                        opResult.Success = true;
                        succeeded++;
                        break;
                    }
                    case "tracked_insertion":
                    {
                        session.AddTrackedInsertionByText(
                            op.AnchorText ?? throw new ArgumentException("anchorText is required"),
                            op.InsertionText ?? throw new ArgumentException("insertionText is required"),
                            op.Position ?? "after",
                            op.Author ?? "dyad");
                        opResult.Success = true;
                        succeeded++;
                        break;
                    }
                    case "tracked_deletion":
                    {
                        session.AddTrackedDeletionByText(
                            op.DeleteText ?? throw new ArgumentException("deleteText is required"),
                            op.Author ?? "dyad");
                        opResult.Success = true;
                        succeeded++;
                        break;
                    }
                    default:
                        throw new ArgumentException($"Unknown operation type: {op.Type}");
                }
            }
            catch (Exception ex)
            {
                opResult.Success = false;
                opResult.Error = ex.Message;
                failed++;
            }

            results.Add(opResult);
        }

        var validationErrors = session.Validate();
        session.Save();

        return new JsonResponse
        {
            Success = failed == 0,
            OutputPath = outputPath,
            Results = results,
            ValidationErrors = validationErrors.Count > 0 ? validationErrors : null,
            Summary = new JsonSummary
            {
                Total = operations.Count,
                Succeeded = succeeded,
                Failed = failed
            }
        };
    }

    static JsonResponse HandleReadComments(JsonRequest request)
    {
        if (string.IsNullOrEmpty(request.InputPath))
            return new JsonResponse { Success = false, Error = "inputPath is required" };

        if (!File.Exists(request.InputPath))
            return new JsonResponse { Success = false, Error = $"Input file not found: {request.InputPath}" };

        var reader = new DocxReader();
        var content = reader.Read(request.InputPath);

        return new JsonResponse
        {
            Success = true,
            Comments = content.Comments,
            TrackedChanges = content.TrackedChanges,
            Metadata = content.Metadata
        };
    }

    static JsonResponse HandleValidate(JsonRequest request)
    {
        if (string.IsNullOrEmpty(request.InputPath))
            return new JsonResponse { Success = false, Error = "inputPath is required" };

        if (!File.Exists(request.InputPath))
            return new JsonResponse { Success = false, Error = $"Input file not found: {request.InputPath}" };

        var tempPath = Path.Combine(Path.GetTempPath(), $"validate-{Guid.NewGuid():N}.docx");
        try
        {
            var writer = new DocxWriter();
            using var session = writer.Open(request.InputPath, tempPath);
            var errors = session.Validate();

            return new JsonResponse
            {
                Success = true,
                Errors = errors.Count > 0 ? errors : null
            };
        }
        finally
        {
            if (File.Exists(tempPath))
                File.Delete(tempPath);
        }
    }

    // ---- Legacy CLI handlers ----

    static int ReadDocument(string inputPath)
    {
        if (!File.Exists(inputPath))
        {
            Console.Error.WriteLine($"File not found: {inputPath}");
            return 1;
        }

        var reader = new DocxReader();
        var content = reader.Read(inputPath);
        var json = JsonSerializer.Serialize(content, jsonOptions);
        Console.WriteLine(json);
        return 0;
    }

    static int AddComment(string inputPath, string outputPath, int paraIndex, int start, int end, string author, string text)
    {
        if (!File.Exists(inputPath))
        {
            Console.Error.WriteLine($"File not found: {inputPath}");
            return 1;
        }

        var writer = new DocxWriter();
        using var session = writer.Open(inputPath, outputPath);
        var commentId = session.AddComment(new AddCommentOperation
        {
            ParagraphIndex = paraIndex,
            StartCharOffset = start,
            EndCharOffset = end,
            Author = author,
            CommentText = text
        });
        session.Save();

        Console.WriteLine($"Added comment with ID: {commentId}");
        Console.WriteLine($"Output written to: {outputPath}");
        return 0;
    }

    static int AddCommentByText(string inputPath, string outputPath, string anchorText, string author, string commentText)
    {
        if (!File.Exists(inputPath))
        {
            Console.Error.WriteLine($"File not found: {inputPath}");
            return 1;
        }

        var writer = new DocxWriter();
        using var session = writer.Open(inputPath, outputPath);
        var commentId = session.AddCommentByText(anchorText, author, commentText);
        session.Save();

        Console.WriteLine($"Added comment with ID: {commentId} anchored to: \"{anchorText}\"");
        Console.WriteLine($"Output written to: {outputPath}");
        return 0;
    }

    static int AddReply(string inputPath, string outputPath, string commentId, string author, string replyText)
    {
        if (!File.Exists(inputPath))
        {
            Console.Error.WriteLine($"File not found: {inputPath}");
            return 1;
        }

        var writer = new DocxWriter();
        using var session = writer.Open(inputPath, outputPath);
        var replyId = session.AddCommentReply(commentId, author, replyText);
        session.Save();

        Console.WriteLine($"Added reply with ID: {replyId} to comment: {commentId}");
        Console.WriteLine($"Output written to: {outputPath}");
        return 0;
    }

    static int ValidateDocument(string filePath)
    {
        if (!File.Exists(filePath))
        {
            Console.Error.WriteLine($"File not found: {filePath}");
            return 1;
        }

        // Open as a temporary copy to validate
        var tempPath = Path.Combine(Path.GetTempPath(), $"validate-{Guid.NewGuid():N}.docx");
        try
        {
            var writer = new DocxWriter();
            using var session = writer.Open(filePath, tempPath);
            var errors = session.Validate();

            if (errors.Count == 0)
            {
                Console.WriteLine("Document is valid. No errors found.");
                return 0;
            }
            else
            {
                Console.Error.WriteLine($"Found {errors.Count} validation error(s):");
                foreach (var error in errors)
                {
                    Console.Error.WriteLine($"  {error}");
                }
                return 1;
            }
        }
        finally
        {
            if (File.Exists(tempPath))
                File.Delete(tempPath);
        }
    }

    static int GenerateFixtures(string outputDir)
    {
        Console.Error.WriteLine($"Generating fixtures in: {outputDir}");
        TestFixtures.GenerateAll(outputDir);
        Console.Error.WriteLine("Generated:");
        foreach (var file in Directory.GetFiles(outputDir, "*.docx"))
        {
            Console.Error.WriteLine($"  {Path.GetFileName(file)}");
        }
        return 0;
    }

    static void PrintUsage()
    {
        Console.Error.WriteLine("DocxWorker — Read and annotate .docx files for AI agents");
        Console.Error.WriteLine();
        Console.Error.WriteLine("Commands:");
        Console.Error.WriteLine("  --json <request-file>                                                      JSON protocol mode");
        Console.Error.WriteLine("  read <input.docx>                                                          Read and dump document as JSON");
        Console.Error.WriteLine("  add-comment <in.docx> <out.docx> <para> <start> <end> <author> <text>      Add a comment by index");
        Console.Error.WriteLine("  add-comment-text <in.docx> <out.docx> <anchor-text> <author> <comment>     Add a comment by text match");
        Console.Error.WriteLine("  reply <in.docx> <out.docx> <comment-id> <author> <reply-text>              Add a threaded reply");
        Console.Error.WriteLine("  validate <file.docx>                                                       Validate document structure");
        Console.Error.WriteLine("  generate-fixtures <output-dir>                                             Generate test .docx files");
    }
}
