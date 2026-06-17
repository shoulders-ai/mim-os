using System.Xml;
using System.Xml.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using DocumentFormat.OpenXml.Wordprocessing;

namespace DocxWorker;

/// <summary>
/// Applies write operations to a COPY of a .docx file. Never modifies the original.
/// </summary>
public class DocxWriter
{
    /// <summary>
    /// Copies the input file to the output path, then opens the copy for modification.
    /// Returns a WriterSession that can apply operations.
    /// </summary>
    public WriterSession Open(string inputPath, string outputPath)
    {
        File.Copy(inputPath, outputPath, overwrite: true);
        return new WriterSession(outputPath);
    }
}

public class WriterSession : IDisposable
{
    private readonly WordprocessingDocument _doc;
    private readonly string _outputPath;
    private readonly TextSearcher _searcher = new();
    private bool _disposed;
    private int _nextParaId = 0x10000000; // Start high to avoid collisions with existing paraIds

    internal WriterSession(string outputPath)
    {
        _outputPath = outputPath;
        _doc = WordprocessingDocument.Open(outputPath, true);
        _nextParaId = ScanHighestParaId() + 1;
    }

    /// <summary>
    /// Scans the document for the highest existing paraId to avoid collisions.
    /// Checks both comment paragraphs and commentsExtended entries.
    /// </summary>
    private int ScanHighestParaId()
    {
        int highest = 0x10000000 - 1; // Minimum starting value

        // Scan comment paragraphs for w14:paraId attributes
        var commentsPart = _doc.MainDocumentPart?.WordprocessingCommentsPart;
        if (commentsPart?.Comments != null)
        {
            foreach (var comment in commentsPart.Comments.Elements<Comment>())
            {
                foreach (var para in comment.Elements<Paragraph>())
                {
                    var paraIdAttr = para.GetAttributes().FirstOrDefault(a => a.LocalName == "paraId");
                    if (paraIdAttr.Value != null && int.TryParse(paraIdAttr.Value, System.Globalization.NumberStyles.HexNumber, null, out int id))
                    {
                        if (id > highest) highest = id;
                    }
                }
            }
        }

        // Scan commentsExtended for paraId values
        var extPart = _doc.MainDocumentPart?.WordprocessingCommentsExPart;
        if (extPart != null)
        {
            try
            {
                using var stream = extPart.GetStream(FileMode.Open);
                var xdoc = System.Xml.Linq.XDocument.Load(stream);
                var w15 = System.Xml.Linq.XNamespace.Get("http://schemas.microsoft.com/office/word/2012/wordml");
                foreach (var entry in xdoc.Descendants(w15 + "commentEx"))
                {
                    var paraId = entry.Attribute(w15 + "paraId")?.Value;
                    if (paraId != null && int.TryParse(paraId, System.Globalization.NumberStyles.HexNumber, null, out int id))
                    {
                        if (id > highest) highest = id;
                    }
                }
            }
            catch { /* If parsing fails, use default */ }
        }

        return highest;
    }

    // ---- Text-match comment API ----

    /// <summary>
    /// Add comment anchored to a text match. Finds the first occurrence.
    /// Returns the new comment ID.
    /// </summary>
    public string AddCommentByText(string anchorText, string author, string commentText)
    {
        return AddCommentByTextWithResult(anchorText, author, commentText, 0).CommentId;
    }

    /// <summary>
    /// Add comment anchored to a specific occurrence of text (0-based occurrence index).
    /// Returns the new comment ID.
    /// </summary>
    public string AddCommentByText(string anchorText, string author, string commentText, int occurrenceIndex)
    {
        return AddCommentByTextWithResult(anchorText, author, commentText, occurrenceIndex).CommentId;
    }

    /// <summary>
    /// Add comment with full result including whether normalized matching was used.
    /// </summary>
    public CommentResult AddCommentByTextWithResult(string anchorText, string author, string commentText, int occurrenceIndex = 0)
    {
        var body = GetBody();
        bool usedNormalized = false;
        var allOccurrences = _searcher.FindAllOccurrences(body, anchorText);

        if (allOccurrences.Count == 0)
        {
            var normalizedResult = _searcher.FindTextNormalized(body, anchorText);
            if (normalizedResult == null)
                throw new ArgumentException($"Text not found in document: \"{anchorText}\"");
            allOccurrences = new List<TextSearchResult> { normalizedResult };
            usedNormalized = true;
        }

        if (occurrenceIndex >= allOccurrences.Count)
            throw new ArgumentException($"Occurrence index {occurrenceIndex} out of range (only {allOccurrences.Count} occurrences found)");

        var match = allOccurrences[occurrenceIndex];
        var commentId = AddComment(new AddCommentOperation
        {
            ParagraphIndex = match.ParagraphIndex,
            StartCharOffset = match.StartCharOffset,
            EndCharOffset = match.EndCharOffset,
            Author = author,
            CommentText = commentText
        });

        return new CommentResult
        {
            CommentId = commentId,
            UsedNormalizedMatch = usedNormalized,
            MatchedText = match.FoundText
        };
    }

    // ---- Index-based comment API (existing, fixed) ----

    /// <summary>
    /// Adds a comment anchored to a text range in a paragraph.
    /// Returns the new comment's ID.
    /// </summary>
    public string AddComment(AddCommentOperation op)
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");
        var document = mainPart.Document
            ?? throw new InvalidOperationException("Document has no document root");
        var body = document.Body
            ?? throw new InvalidOperationException("Document has no body");

        // Ensure comments part exists
        var commentsPart = mainPart.WordprocessingCommentsPart;
        if (commentsPart == null)
        {
            commentsPart = mainPart.AddNewPart<WordprocessingCommentsPart>();
            commentsPart.Comments = new Comments();
        }
        var comments = commentsPart.Comments
            ?? throw new InvalidOperationException("Document comments part is not initialized");

        // Determine next comment ID
        var existingIds = comments.Elements<Comment>()
            .Select(c => int.TryParse(c.Id?.Value, out int id) ? id : 0)
            .ToList();
        int nextId = existingIds.Any() ? existingIds.Max() + 1 : 1;
        var commentId = nextId.ToString();

        // Create the comment with a paraId for commentsExtended threading
        var paraId = GenerateParaId();
        var comment = new Comment
        {
            Id = commentId,
            Author = op.Author,
            Date = DateTime.UtcNow,
            Initials = op.Author.Length > 0 ? op.Author[..Math.Min(2, op.Author.Length)].ToUpperInvariant() : "XX"
        };
        var commentPara = new Paragraph(
            new ParagraphProperties(new ParagraphStyleId { Val = "CommentText" }),
            new Run(new Text(op.CommentText))
        );
        // Set w14:paraId on the comment paragraph
        SetParaId(commentPara, paraId);
        comment.Append(commentPara);
        commentsPart.Comments.Append(comment);

        // Write commentsExtended entry for this comment (no parent)
        EnsureCommentsExEntry(paraId, null, false);

        // Insert comment range markers into the target paragraph
        var paragraphs = body.Descendants<Paragraph>().ToList();
        if (op.ParagraphIndex < 0 || op.ParagraphIndex >= paragraphs.Count)
            throw new ArgumentException($"Paragraph index {op.ParagraphIndex} out of range (0-{paragraphs.Count - 1})");

        var targetPara = paragraphs[op.ParagraphIndex];
        InsertCommentAnchors(targetPara, commentId, op.StartCharOffset, op.EndCharOffset);

        return commentId;
    }

    /// <summary>
    /// Adds a reply to an existing comment with proper threading via commentsExtended.
    /// </summary>
    public string AddCommentReply(string parentCommentId, string author, string replyText)
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");

        var commentsPart = mainPart.WordprocessingCommentsPart;
        if (commentsPart?.Comments == null)
            throw new ArgumentException($"Parent comment {parentCommentId} not found (document has no comments)");

        // Find the parent comment to verify it exists
        var parentComment = commentsPart.Comments.Elements<Comment>()
            .FirstOrDefault(c => c.Id?.Value == parentCommentId)
            ?? throw new ArgumentException($"Parent comment {parentCommentId} not found");

        // Get or create paraId for the parent comment
        var parentParaId = GetOrCreateCommentParaId(parentComment);

        // Determine next comment ID
        var existingIds = commentsPart.Comments.Elements<Comment>()
            .Select(c => int.TryParse(c.Id?.Value, out int id) ? id : 0)
            .ToList();
        int nextId = existingIds.Any() ? existingIds.Max() + 1 : 1;
        var replyId = nextId.ToString();

        // Create the reply comment with a paraId
        var replyParaId = GenerateParaId();
        var reply = new Comment
        {
            Id = replyId,
            Author = author,
            Date = DateTime.UtcNow,
            Initials = author.Length > 0 ? author[..Math.Min(2, author.Length)].ToUpperInvariant() : "XX"
        };
        var replyPara = new Paragraph(
            new ParagraphProperties(new ParagraphStyleId { Val = "CommentText" }),
            new Run(new Text(replyText))
        );
        SetParaId(replyPara, replyParaId);
        reply.Append(replyPara);
        commentsPart.Comments.Append(reply);

        // Ensure parent has a commentsEx entry
        EnsureCommentsExEntry(parentParaId, null, false);
        // Write the reply's commentsEx entry with threading
        EnsureCommentsExEntry(replyParaId, parentParaId, false);

        return replyId;
    }

    /// <summary>
    /// Adds a reply using the legacy operation model (backward compat).
    /// </summary>
    public string AddCommentReply(AddCommentReplyOperation op)
    {
        return AddCommentReply(op.ParentCommentId, op.Author, op.ReplyText);
    }

    /// <summary>
    /// Resolves a comment by setting done="1" in commentsExtended.
    /// </summary>
    public void ResolveComment(string commentId)
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");

        var commentsPart = mainPart.WordprocessingCommentsPart
            ?? throw new InvalidOperationException("Document has no comments");

        var comments = commentsPart.Comments
            ?? throw new InvalidOperationException("Document comments part is not initialized");

        var comment = comments.Elements<Comment>()
            .FirstOrDefault(c => c.Id?.Value == commentId)
            ?? throw new ArgumentException($"Comment {commentId} not found");

        var paraId = GetOrCreateCommentParaId(comment);
        EnsureCommentsExEntry(paraId, null, true);
    }

    // ---- Text-match tracked changes API ----

    /// <summary>
    /// Add tracked insertion by text match.
    /// Position is "before", "after", or "replace" relative to the anchor text.
    /// </summary>
    public void AddTrackedInsertionByText(string anchorText, string insertionText, string position, string author)
    {
        var body = GetBody();
        var match = _searcher.FindText(body, anchorText)
            ?? throw new ArgumentException($"Text not found in document: \"{anchorText}\"");

        var paragraphs = body.Descendants<Paragraph>().ToList();
        var targetPara = paragraphs[match.ParagraphIndex];
        var revId = GenerateRevisionId(body);

        switch (position.ToLowerInvariant())
        {
            case "before":
                InsertTrackedText(targetPara, match.StartCharOffset, insertionText, author, revId);
                break;
            case "after":
                InsertTrackedText(targetPara, match.EndCharOffset, insertionText, author, revId);
                break;
            case "replace":
                // Replace = tracked deletion of anchor + tracked insertion of new text
                var delRevId = revId;
                MarkTextAsDeleted(targetPara, match.StartCharOffset, match.EndCharOffset, author, delRevId);
                // After deletion, insert at the start position
                var insRevId = (int.Parse(delRevId) + 1).ToString();
                InsertTrackedTextAfterDeletion(targetPara, match.StartCharOffset, insertionText, author, insRevId);
                break;
            default:
                throw new ArgumentException($"Invalid position: {position}. Use 'before', 'after', or 'replace'.");
        }
    }

    /// <summary>
    /// Add tracked deletion by text match.
    /// </summary>
    public void AddTrackedDeletionByText(string deleteText, string author)
    {
        var body = GetBody();
        var match = _searcher.FindText(body, deleteText)
            ?? throw new ArgumentException($"Text not found in document: \"{deleteText}\"");

        var paragraphs = body.Descendants<Paragraph>().ToList();
        var targetPara = paragraphs[match.ParagraphIndex];
        var revId = GenerateRevisionId(body);

        MarkTextAsDeleted(targetPara, match.StartCharOffset, match.EndCharOffset, author, revId);
    }

    // ---- Existing index-based tracked change API ----

    /// <summary>
    /// Inserts text as a tracked change (insertion) at the given position.
    /// </summary>
    public void AddTrackedInsertion(AddTrackedInsertionOperation op)
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");
        var document = mainPart.Document
            ?? throw new InvalidOperationException("Document has no document root");
        var body = document.Body
            ?? throw new InvalidOperationException("Document has no body");

        var paragraphs = body.Descendants<Paragraph>().ToList();
        if (op.ParagraphIndex < 0 || op.ParagraphIndex >= paragraphs.Count)
            throw new ArgumentException($"Paragraph index {op.ParagraphIndex} out of range");

        var targetPara = paragraphs[op.ParagraphIndex];
        var revId = GenerateRevisionId(body);
        InsertTrackedText(targetPara, op.Position, op.TextToInsert, op.Author, revId);
    }

    /// <summary>
    /// Marks text as deleted (tracked deletion).
    /// </summary>
    public void AddTrackedDeletion(AddTrackedDeletionOperation op)
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");
        var document = mainPart.Document
            ?? throw new InvalidOperationException("Document has no document root");
        var body = document.Body
            ?? throw new InvalidOperationException("Document has no body");

        var paragraphs = body.Descendants<Paragraph>().ToList();
        if (op.ParagraphIndex < 0 || op.ParagraphIndex >= paragraphs.Count)
            throw new ArgumentException($"Paragraph index {op.ParagraphIndex} out of range");

        var targetPara = paragraphs[op.ParagraphIndex];
        var revId = GenerateRevisionId(body);
        MarkTextAsDeleted(targetPara, op.StartOffset, op.EndOffset, op.Author, revId);
    }

    // ---- Validation ----

    /// <summary>
    /// Validates the document and returns a list of validation errors.
    /// Empty list means the document is valid.
    /// </summary>
    public List<string> Validate()
    {
        var validator = new OpenXmlValidator(FileFormatVersions.Office2013);
        var errors = validator.Validate(_doc);
        return errors.Select(e => $"[{e.ErrorType}] {e.Description} (Part: {e.Part?.Uri}, Path: {e.Path?.XPath})").ToList();
    }

    // ---- Save/Dispose ----

    /// <summary>
    /// Saves and closes the document.
    /// </summary>
    public void Save()
    {
        _doc.Save();
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _doc.Dispose();
            _disposed = true;
        }
    }

    // ---- Private helpers ----

    private Body GetBody()
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");
        var document = mainPart.Document
            ?? throw new InvalidOperationException("Document has no document root");
        return document.Body
            ?? throw new InvalidOperationException("Document has no body");
    }

    /// <summary>
    /// FIXED: Inserts CommentRangeStart, CommentRangeEnd, and CommentReference markers
    /// at the correct character offsets, handling text split across fragmented runs.
    /// EndCharOffset is exclusive (C# string range convention).
    /// </summary>
    private void InsertCommentAnchors(Paragraph para, string commentId, int startOffset, int endOffset)
    {
        var runs = para.Elements<Run>().ToList();
        int currentOffset = 0;
        bool startInserted = false;
        bool endInserted = false;

        foreach (var run in runs)
        {
            var textElem = run.GetFirstChild<Text>();
            if (textElem == null)
            {
                // Skip runs without text (e.g., field chars, comment references)
                continue;
            }

            var text = textElem.Text;
            int runStart = currentOffset;
            int runEnd = currentOffset + text.Length;

            // Insert CommentRangeStart
            if (!startInserted && startOffset >= runStart && startOffset <= runEnd)
            {
                if (startOffset == runStart)
                {
                    run.InsertBeforeSelf(new CommentRangeStart { Id = commentId });
                    startInserted = true;
                }
                else if (startOffset < runEnd)
                {
                    // Split the run at startOffset
                    var splitPos = startOffset - runStart;
                    var beforeText = text[..splitPos];
                    var afterText = text[splitPos..];

                    textElem.Text = beforeText;
                    textElem.Space = SpaceProcessingModeValues.Preserve;

                    var newRun = new Run(new Text(afterText) { Space = SpaceProcessingModeValues.Preserve });
                    if (run.RunProperties != null)
                        newRun.PrependChild(run.RunProperties.CloneNode(true));

                    run.InsertAfterSelf(newRun);
                    newRun.InsertBeforeSelf(new CommentRangeStart { Id = commentId });

                    startInserted = true;

                    // Check if end is also in this same original run
                    if (!endInserted && endOffset <= runEnd)
                    {
                        var endSplitPos = endOffset - startOffset;

                        if (endSplitPos >= afterText.Length)
                        {
                            // End is at or after the end of the afterText portion
                            newRun.InsertAfterSelf(new Run(new CommentReference { Id = commentId }));
                            newRun.InsertAfterSelf(new CommentRangeEnd { Id = commentId });
                            endInserted = true;
                        }
                        else
                        {
                            var endBefore = afterText[..endSplitPos];
                            var endAfter = afterText[endSplitPos..];

                            var newText = newRun.GetFirstChild<Text>()!;
                            newText.Text = endBefore;

                            var endRun = new Run(new Text(endAfter) { Space = SpaceProcessingModeValues.Preserve });
                            if (run.RunProperties != null)
                                endRun.PrependChild(run.RunProperties.CloneNode(true));

                            newRun.InsertAfterSelf(endRun);
                            endRun.InsertBeforeSelf(new CommentRangeEnd { Id = commentId });
                            endRun.InsertBeforeSelf(new Run(new CommentReference { Id = commentId }));
                            endInserted = true;
                        }
                    }

                    currentOffset += text.Length;
                    continue;
                }
                else
                {
                    // startOffset == runEnd: will be handled in the next run
                    // (startOffset is at the boundary between this run and the next)
                }
            }

            // Insert CommentRangeEnd
            if (startInserted && !endInserted && endOffset >= runStart && endOffset <= runEnd)
            {
                if (endOffset == runEnd)
                {
                    // Insert after this run
                    run.InsertAfterSelf(new Run(new CommentReference { Id = commentId }));
                    run.InsertAfterSelf(new CommentRangeEnd { Id = commentId });
                }
                else if (endOffset == runStart)
                {
                    // End is at the start of this run — insert before it
                    run.InsertBeforeSelf(new CommentRangeEnd { Id = commentId });
                    run.InsertBeforeSelf(new Run(new CommentReference { Id = commentId }));
                }
                else
                {
                    var splitPos = endOffset - runStart;
                    var beforeText = text[..splitPos];
                    var afterText = text[splitPos..];

                    textElem.Text = beforeText;
                    textElem.Space = SpaceProcessingModeValues.Preserve;

                    var newRun = new Run(new Text(afterText) { Space = SpaceProcessingModeValues.Preserve });
                    if (run.RunProperties != null)
                        newRun.PrependChild(run.RunProperties.CloneNode(true));

                    run.InsertAfterSelf(newRun);
                    newRun.InsertBeforeSelf(new CommentRangeEnd { Id = commentId });
                    newRun.InsertBeforeSelf(new Run(new CommentReference { Id = commentId }));
                }
                endInserted = true;
            }

            currentOffset += text.Length;
        }

        // If we haven't inserted markers (e.g., offsets at start/end), add them
        if (!startInserted)
        {
            var firstRun = para.Elements<Run>().FirstOrDefault();
            if (firstRun != null)
                firstRun.InsertBeforeSelf(new CommentRangeStart { Id = commentId });
        }

        if (!endInserted)
        {
            var lastRun = para.Elements<Run>().LastOrDefault();
            if (lastRun != null)
            {
                lastRun.InsertAfterSelf(new Run(new CommentReference { Id = commentId }));
                lastRun.InsertAfterSelf(new CommentRangeEnd { Id = commentId });
            }
        }
    }

    private void InsertTrackedText(Paragraph para, int position, string textToInsert, string author, string revId)
    {
        var runs = para.Elements<Run>().ToList();
        int currentOffset = 0;

        foreach (var run in runs)
        {
            var textElem = run.GetFirstChild<Text>();
            if (textElem == null) continue;

            var text = textElem.Text;
            int runStart = currentOffset;
            int runEnd = currentOffset + text.Length;

            if (position >= runStart && position <= runEnd)
            {
                var insertedRun = new InsertedRun
                {
                    Author = author,
                    Date = DateTime.UtcNow,
                    Id = revId
                };
                insertedRun.Append(new Run(new Text(textToInsert) { Space = SpaceProcessingModeValues.Preserve }));

                if (position == runStart)
                {
                    run.InsertBeforeSelf(insertedRun);
                }
                else if (position == runEnd)
                {
                    run.InsertAfterSelf(insertedRun);
                }
                else
                {
                    // Split the run
                    var splitPos = position - runStart;
                    var beforeText = text[..splitPos];
                    var afterText = text[splitPos..];

                    textElem.Text = beforeText;
                    textElem.Space = SpaceProcessingModeValues.Preserve;

                    var afterRun = new Run(new Text(afterText) { Space = SpaceProcessingModeValues.Preserve });
                    if (run.RunProperties != null)
                        afterRun.PrependChild(run.RunProperties.CloneNode(true));

                    run.InsertAfterSelf(afterRun);
                    afterRun.InsertBeforeSelf(insertedRun);
                }
                return;
            }

            currentOffset += text.Length;
        }

        // If position is at the end, append
        var ins = new InsertedRun
        {
            Author = author,
            Date = DateTime.UtcNow,
            Id = revId
        };
        ins.Append(new Run(new Text(textToInsert) { Space = SpaceProcessingModeValues.Preserve }));
        para.Append(ins);
    }

    /// <summary>
    /// Inserts tracked text after a deletion has been applied at the given offset.
    /// After MarkTextAsDeleted, the paragraph structure has changed, so we need to
    /// find the right insertion point by walking the modified paragraph.
    /// </summary>
    private void InsertTrackedTextAfterDeletion(Paragraph para, int startOffset, string textToInsert, string author, string revId)
    {
        // After deletion, we need to find the DeletedRun and insert after it
        // Walk through looking for the DeletedRun that was just created
        int currentOffset = 0;
        OpenXmlElement? insertAfter = null;

        foreach (var child in para.ChildElements)
        {
            if (child is Run run)
            {
                var textElem = run.GetFirstChild<Text>();
                if (textElem != null)
                {
                    if (currentOffset == startOffset)
                    {
                        // Insert before this run
                        insertAfter = run;
                        break;
                    }
                    currentOffset += textElem.Text.Length;
                }
            }
            else if (child is DeletedRun del)
            {
                // This is likely the deletion we just created
                // The tracked insertion should go right after it
                if (currentOffset == startOffset || insertAfter == null)
                {
                    insertAfter = del;
                }
            }
        }

        var insertedRun = new InsertedRun
        {
            Author = author,
            Date = DateTime.UtcNow,
            Id = revId
        };
        insertedRun.Append(new Run(new Text(textToInsert) { Space = SpaceProcessingModeValues.Preserve }));

        if (insertAfter is DeletedRun)
        {
            insertAfter.InsertAfterSelf(insertedRun);
        }
        else if (insertAfter is Run targetRun)
        {
            targetRun.InsertBeforeSelf(insertedRun);
        }
        else
        {
            // Fallback: append to paragraph
            para.Append(insertedRun);
        }
    }

    private void MarkTextAsDeleted(Paragraph para, int startOffset, int endOffset, string author, string revId)
    {
        // Collect all text-bearing children: top-level Runs AND Runs inside InsertedRuns
        var textBearers = new List<(Run run, OpenXmlElement parent)>();
        foreach (var child in para.ChildElements.ToList())
        {
            if (child is Run topRun && topRun.GetFirstChild<Text>() != null)
            {
                textBearers.Add((topRun, para));
            }
            else if (child is InsertedRun ins)
            {
                foreach (var insRun in ins.Elements<Run>().ToList())
                {
                    if (insRun.GetFirstChild<Text>() != null)
                        textBearers.Add((insRun, ins));
                }
            }
        }

        int currentOffset = 0;
        foreach (var (run, parent) in textBearers)
        {
            var textElem = run.GetFirstChild<Text>()!;
            var text = textElem.Text;
            int runStart = currentOffset;
            int runEnd = currentOffset + text.Length;

            if (runEnd > startOffset && runStart < endOffset)
            {
                int overlapStart = Math.Max(startOffset, runStart) - runStart;
                int overlapEnd = Math.Min(endOffset, runEnd) - runStart;

                var beforeText = text[..overlapStart];
                var deletedText = text[overlapStart..overlapEnd];
                var afterText = text[overlapEnd..];

                var elements = new List<OpenXmlElement>();

                if (beforeText.Length > 0)
                {
                    var beforeRun = new Run(new Text(beforeText) { Space = SpaceProcessingModeValues.Preserve });
                    if (run.RunProperties != null)
                        beforeRun.PrependChild(run.RunProperties.CloneNode(true));
                    elements.Add(beforeRun);
                }

                var del = new DeletedRun
                {
                    Author = author,
                    Date = DateTime.UtcNow,
                    Id = revId
                };
                var delRun = new Run(new DeletedText(deletedText) { Space = SpaceProcessingModeValues.Preserve });
                if (run.RunProperties != null)
                    delRun.PrependChild(run.RunProperties.CloneNode(true));
                del.Append(delRun);
                elements.Add(del);

                if (afterText.Length > 0)
                {
                    var afterRun = new Run(new Text(afterText) { Space = SpaceProcessingModeValues.Preserve });
                    if (run.RunProperties != null)
                        afterRun.PrependChild(run.RunProperties.CloneNode(true));
                    elements.Add(afterRun);
                }

                // If this run is inside an InsertedRun, we need to handle it differently:
                // split the InsertedRun around the deletion
                if (parent is InsertedRun insParent)
                {
                    var insAuthor = insParent.Author?.Value ?? author;
                    var insDate = insParent.Date?.Value ?? DateTime.UtcNow;
                    var insId = insParent.Id?.Value ?? revId;

                    OpenXmlElement insertPoint = insParent;

                    // Before-text stays as an InsertedRun
                    if (beforeText.Length > 0)
                    {
                        var beforeIns = new InsertedRun { Author = insAuthor, Date = insDate, Id = insId };
                        beforeIns.Append(elements[0]); // the beforeRun
                        insertPoint.InsertAfterSelf(beforeIns);
                        insertPoint = beforeIns;
                        elements.RemoveAt(0);
                    }

                    // The DeletedRun goes as a top-level element
                    insertPoint.InsertAfterSelf(del);
                    insertPoint = del;
                    elements.Remove(del);

                    // After-text stays as an InsertedRun
                    if (afterText.Length > 0 && elements.Count > 0)
                    {
                        var afterIns = new InsertedRun { Author = insAuthor, Date = insDate, Id = insId };
                        afterIns.Append(elements[0]);
                        insertPoint.InsertAfterSelf(afterIns);
                        insertPoint = afterIns;
                    }

                    // Remove the original run from the InsertedRun
                    run.Remove();
                    // If InsertedRun is now empty, remove it
                    if (!insParent.Elements<Run>().Any())
                        insParent.Remove();
                }
                else
                {
                    // Top-level run: replace in place (existing logic)
                    OpenXmlElement insertPoint = run;
                    foreach (var elem in elements)
                    {
                        insertPoint.InsertAfterSelf(elem);
                        insertPoint = elem;
                    }
                    run.Remove();
                }
            }

            currentOffset += text.Length;
        }
    }

    private string GenerateRevisionId(Body body)
    {
        int maxId = 0;

        foreach (var ins in body.Descendants<InsertedRun>())
        {
            if (int.TryParse(ins.Id?.Value, out int id) && id > maxId)
                maxId = id;
        }
        foreach (var del in body.Descendants<DeletedRun>())
        {
            if (int.TryParse(del.Id?.Value, out int id) && id > maxId)
                maxId = id;
        }

        return (maxId + 1).ToString();
    }

    // ---- CommentsExtended (w15) helpers ----

    private static readonly XNamespace W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
    private static readonly XNamespace MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";

    /// <summary>
    /// Generates a unique paraId for comment threading.
    /// </summary>
    private string GenerateParaId()
    {
        return (_nextParaId++).ToString("X8");
    }

    /// <summary>
    /// Sets the w14:paraId attribute on a paragraph element.
    /// </summary>
    private static void SetParaId(Paragraph para, string paraId)
    {
        var w14 = "http://schemas.microsoft.com/office/word/2010/wordml";
        para.SetAttribute(new OpenXmlAttribute("w14", "paraId", w14, paraId));
    }

    /// <summary>
    /// Gets the paraId from a comment's first paragraph, or creates one if missing.
    /// </summary>
    private string GetOrCreateCommentParaId(Comment comment)
    {
        var firstPara = comment.Elements<Paragraph>().FirstOrDefault();
        if (firstPara != null)
        {
            var paraIdAttr = firstPara.GetAttributes().FirstOrDefault(a => a.LocalName == "paraId");
            if (paraIdAttr.Value != null)
                return paraIdAttr.Value;
        }

        // No paraId found — create one
        var paraId = GenerateParaId();
        if (firstPara != null)
        {
            SetParaId(firstPara, paraId);
        }
        else
        {
            // Comment has no paragraphs — add one
            var newPara = new Paragraph(new Run(new Text("")));
            SetParaId(newPara, paraId);
            comment.Append(newPara);
        }

        return paraId;
    }

    /// <summary>
    /// Ensures a commentsEx entry exists for the given paraId.
    /// If parentParaId is non-null, sets the threading relationship.
    /// If done is true, marks the comment as resolved.
    /// </summary>
    private void EnsureCommentsExEntry(string paraId, string? parentParaId, bool done)
    {
        var mainPart = _doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");

        // Get or create the commentsEx part
        var extPart = mainPart.WordprocessingCommentsExPart;
        XDocument xdoc;

        if (extPart == null)
        {
            extPart = mainPart.AddNewPart<WordprocessingCommentsExPart>();
            xdoc = new XDocument(
                new XDeclaration("1.0", "UTF-8", "yes"),
                new XElement(W15 + "commentsEx",
                    new XAttribute(XNamespace.Xmlns + "w15", W15.NamespaceName),
                    new XAttribute(XNamespace.Xmlns + "mc", MC.NamespaceName)
                )
            );
        }
        else
        {
            using var stream = extPart.GetStream(FileMode.Open);
            xdoc = XDocument.Load(stream);
        }

        var root = xdoc.Root!;

        // Check if entry already exists for this paraId
        var existing = root.Elements(W15 + "commentEx")
            .FirstOrDefault(e => e.Attribute(W15 + "paraId")?.Value == paraId);

        if (existing != null)
        {
            // Update existing entry
            if (done)
                existing.SetAttributeValue(W15 + "done", "1");
            if (parentParaId != null)
                existing.SetAttributeValue(W15 + "paraIdParent", parentParaId);
        }
        else
        {
            // Create new entry
            var entry = new XElement(W15 + "commentEx",
                new XAttribute(W15 + "paraId", paraId),
                new XAttribute(W15 + "done", done ? "1" : "0")
            );
            if (parentParaId != null)
                entry.Add(new XAttribute(W15 + "paraIdParent", parentParaId));

            root.Add(entry);
        }

        // Write back
        using (var writeStream = extPart.GetStream(FileMode.Create))
        {
            xdoc.Save(writeStream);
        }
    }
}
