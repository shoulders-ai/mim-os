using System.Security.Cryptography;
using System.Text;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;

namespace DocxWorker;

/// <summary>
/// Reads a .docx file and extracts a structured representation suitable for LLM consumption.
/// </summary>
public class DocxReader
{
    /// <summary>
    /// Opens a .docx file and returns a structured DocumentContent.
    /// </summary>
    public DocumentContent Read(string filePath)
    {
        using var doc = WordprocessingDocument.Open(filePath, false);
        var mainPart = doc.MainDocumentPart
            ?? throw new InvalidOperationException("Document has no main part");
        var document = mainPart.Document
            ?? throw new InvalidOperationException("Document has no document root");
        var body = document.Body
            ?? throw new InvalidOperationException("Document has no body");

        var content = new DocumentContent();

        // Extract metadata
        content.Metadata = ExtractMetadata(doc);

        // Extract paragraphs, tables, and track positions
        ExtractBodyContent(body, content);

        // Extract comments
        ExtractComments(mainPart, body, content);

        // Extract tracked changes
        ExtractTrackedChanges(body, content);

        // Extract citation fields
        ExtractCitations(body, content);

        // Compute word count
        content.Metadata.WordCount = content.Paragraphs.Sum(p =>
            p.Text.Split(new[] { ' ', '\t', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries).Length);

        return content;
    }

    private DocMetadata ExtractMetadata(WordprocessingDocument doc)
    {
        var props = doc.PackageProperties;
        return new DocMetadata
        {
            Title = props.Title,
            Author = props.Creator,
            CreatedDate = props.Created,
            ModifiedDate = props.Modified,
            Description = props.Description
        };
    }

    private void ExtractBodyContent(Body body, DocumentContent content)
    {
        int paragraphIndex = 0;
        int tableIndex = 0;

        foreach (var element in body.ChildElements)
        {
            if (element is Paragraph para)
            {
                var docPara = ExtractParagraph(para, paragraphIndex);
                content.Paragraphs.Add(docPara);
                paragraphIndex++;
            }
            else if (element is Table table)
            {
                var docTable = ExtractTable(table, tableIndex, paragraphIndex);
                content.Tables.Add(docTable);
                tableIndex++;
            }
        }
    }

    private DocParagraph ExtractParagraph(Paragraph para, int index)
    {
        var text = GetParagraphText(para);
        var styleId = para.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
        var type = DetermineType(para, styleId);

        return new DocParagraph
        {
            Index = index,
            Text = text,
            ContentHash = ComputeHash(text),
            Snippet = text.Length > 80 ? text[..80] + "..." : text,
            StyleId = styleId,
            Type = type
        };
    }

    /// <summary>
    /// Gets the plain text of a paragraph, including text from tracked changes
    /// (insertions are included, deletions are excluded from the "current" text).
    /// Field codes are skipped; only field display text is included.
    /// </summary>
    private string GetParagraphText(Paragraph para)
    {
        var sb = new StringBuilder();
        bool inFieldCode = false;

        foreach (var child in para.ChildElements)
        {
            if (child is Run run)
            {
                // Check for field chars
                var fieldChar = run.GetFirstChild<FieldChar>();
                if (fieldChar != null)
                {
                    if (fieldChar.FieldCharType?.Value == FieldCharValues.Begin)
                        inFieldCode = true;
                    else if (fieldChar.FieldCharType?.Value == FieldCharValues.Separate)
                        inFieldCode = false; // Now we're in the display text
                    else if (fieldChar.FieldCharType?.Value == FieldCharValues.End)
                        inFieldCode = false;
                    continue;
                }

                // Skip field code content
                if (inFieldCode && run.GetFirstChild<FieldCode>() != null)
                    continue;

                // Regular text
                var text = run.GetFirstChild<Text>();
                if (text != null && !inFieldCode || (text != null && !run.Descendants<FieldCode>().Any()))
                {
                    sb.Append(text.Text);
                }
            }
            else if (child is InsertedRun ins)
            {
                // Include inserted text (it's the "current" version)
                foreach (var insRun in ins.Elements<Run>())
                {
                    var text = insRun.GetFirstChild<Text>();
                    if (text != null) sb.Append(text.Text);
                }
            }
            // DeletedRun text is NOT included in current text
        }

        return sb.ToString();
    }

    private string DetermineType(Paragraph para, string? styleId)
    {
        if (styleId != null)
        {
            var lower = styleId.ToLowerInvariant();
            if (lower.StartsWith("heading"))
            {
                // Extract level number
                var levelStr = styleId.Replace("Heading", "").Replace("heading", "");
                if (int.TryParse(levelStr, out int level))
                    return $"heading-{level}";
                return "heading";
            }
            if (lower == "listparagraph" || lower.Contains("list"))
            {
                // Check if it has numbering properties
                var numProps = para.ParagraphProperties?.NumberingProperties;
                if (numProps != null)
                    return "bullet-list";
                return "bullet-list";
            }
        }

        // Check for numbering even without a list style
        var numering = para.ParagraphProperties?.NumberingProperties;
        if (numering != null)
            return "bullet-list";

        return "normal";
    }

    private DocTable ExtractTable(Table table, int tableIndex, int paragraphIndex)
    {
        var docTable = new DocTable
        {
            TableIndex = tableIndex,
            PositionAfterParagraphIndex = paragraphIndex - 1
        };

        var rows = table.Elements<TableRow>().ToList();
        docTable.RowCount = rows.Count;
        docTable.ColumnCount = rows.FirstOrDefault()?.Elements<TableCell>().Count() ?? 0;

        for (int r = 0; r < rows.Count; r++)
        {
            var row = rows[r];
            var docRow = new DocTableRow { RowIndex = r };
            var cells = row.Elements<TableCell>().ToList();

            for (int c = 0; c < cells.Count; c++)
            {
                var cell = cells[c];
                var cellText = string.Join("\n",
                    cell.Elements<Paragraph>().Select(p => GetParagraphText(p)));
                docRow.Cells.Add(new DocTableCell { ColumnIndex = c, Text = cellText });
            }

            docTable.Rows.Add(docRow);
        }

        return docTable;
    }

    private void ExtractComments(MainDocumentPart mainPart, Body body, DocumentContent content)
    {
        var commentsPart = mainPart.WordprocessingCommentsPart;
        if (commentsPart?.Comments == null) return;

        var comments = commentsPart.Comments.Elements<Comment>().ToList();
        if (!comments.Any()) return;

        // Build a map of comment ranges in the document
        var commentAnchors = BuildCommentAnchorMap(body, content);
        var anchoredIds = new HashSet<string>(commentAnchors.Keys);

        // Try to read commentsEx to discover reply threading.
        // The commentsEx part maps paraId -> paraIdParent. We need to map
        // comment IDs to paraIds first, via the paragraphs inside each Comment element.
        var replyParentMap = BuildReplyParentMap(mainPart, comments);

        // First pass: create all comment objects
        var commentMap = new Dictionary<string, DocComment>();
        foreach (var comment in comments)
        {
            var id = comment.Id?.Value ?? "";
            var docComment = new DocComment
            {
                CommentId = id,
                Author = comment.Author?.Value ?? "",
                Date = comment.Date?.Value,
                Text = string.Join(" ", comment.Elements<Paragraph>()
                    .Select(p => string.Join("", p.Descendants<Text>().Select(t => t.Text))))
            };

            if (commentAnchors.TryGetValue(id, out var anchor))
            {
                docComment.AnchorText = anchor.AnchorText;
                docComment.AnchorParagraphIndex = anchor.ParagraphIndex;
                docComment.AnchorStartOffset = anchor.StartOffset;
                docComment.AnchorEndOffset = anchor.EndOffset;
            }

            commentMap[id] = docComment;
        }

        // Build the tree: use replyParentMap if available, else use heuristic
        var topLevelComments = new List<DocComment>();
        var replyIds = new HashSet<string>();

        if (replyParentMap.Count > 0)
        {
            // Use commentsEx data: any comment whose ID is in replyParentMap is a reply
            foreach (var (childId, parentId) in replyParentMap)
            {
                if (commentMap.TryGetValue(childId, out var childComment) &&
                    commentMap.TryGetValue(parentId, out var parentComment))
                {
                    childComment.ReplyToCommentId = parentId;
                    parentComment.Replies.Add(childComment);
                    replyIds.Add(childId);
                }
            }

            foreach (var comment in comments)
            {
                var id = comment.Id?.Value ?? "";
                if (!replyIds.Contains(id))
                    topLevelComments.Add(commentMap[id]);
            }
        }
        else
        {
            // Fallback heuristic: comments without body anchors are replies.
            // Assign each unanchored comment to the anchored comment with the
            // closest lower ID (most likely its parent).
            var anchoredComments = new List<DocComment>();

            foreach (var comment in comments)
            {
                var id = comment.Id?.Value ?? "";
                if (anchoredIds.Contains(id))
                    anchoredComments.Add(commentMap[id]);
            }

            foreach (var comment in comments)
            {
                var id = comment.Id?.Value ?? "";
                var dc = commentMap[id];

                if (anchoredIds.Contains(id))
                {
                    topLevelComments.Add(dc);
                }
                else
                {
                    // Find the best parent: the anchored comment with the
                    // highest ID that's still less than this comment's ID.
                    DocComment? bestParent = null;
                    int myId = int.TryParse(id, out int parsed) ? parsed : int.MaxValue;

                    foreach (var ac in anchoredComments)
                    {
                        int acId = int.TryParse(ac.CommentId, out int acParsed) ? acParsed : 0;
                        if (acId < myId)
                        {
                            if (bestParent == null ||
                                int.Parse(bestParent.CommentId) < acId)
                            {
                                bestParent = ac;
                            }
                        }
                    }

                    if (bestParent != null)
                    {
                        dc.ReplyToCommentId = bestParent.CommentId;
                        bestParent.Replies.Add(dc);
                    }
                    else
                    {
                        topLevelComments.Add(dc);
                    }
                }
            }
        }

        content.Comments = topLevelComments;
    }

    /// <summary>
    /// Tries to parse the commentsEx part to build a map of childCommentId -> parentCommentId.
    /// Uses two strategies:
    /// 1. Match via paraId attributes on Comment paragraphs (real Word files)
    /// 2. Positional matching: Nth commentsEx entry corresponds to Nth comment (programmatic files)
    /// </summary>
    private Dictionary<string, string> BuildReplyParentMap(MainDocumentPart mainPart, List<Comment> comments)
    {
        var result = new Dictionary<string, string>();

        try
        {
            var extPart = mainPart.WordprocessingCommentsExPart;
            if (extPart == null) return result;

            using var stream = extPart.GetStream();
            var xdoc = System.Xml.Linq.XDocument.Load(stream);
            var w15 = System.Xml.Linq.XNamespace.Get("http://schemas.microsoft.com/office/word/2012/wordml");

            var entries = xdoc.Descendants(w15 + "commentEx").ToList();
            if (entries.Count == 0) return result;

            // Strategy 1: Try matching via paraId attributes on Comment paragraphs
            var paraIdToCommentId = new Dictionary<string, string>();
            foreach (var comment in comments)
            {
                var id = comment.Id?.Value ?? "";
                foreach (var para in comment.Elements<Paragraph>())
                {
                    var paraIdAttr = para.GetAttributes().FirstOrDefault(a => a.LocalName == "paraId");
                    if (paraIdAttr.Value != null)
                        paraIdToCommentId[paraIdAttr.Value] = id;
                }
            }

            if (paraIdToCommentId.Count > 0)
            {
                // Resolve via paraId matching
                foreach (var entry in entries)
                {
                    var paraId = entry.Attribute(w15 + "paraId")?.Value;
                    var parentParaId = entry.Attribute(w15 + "paraIdParent")?.Value;
                    if (paraId != null && parentParaId != null &&
                        paraIdToCommentId.TryGetValue(paraId, out var childId) &&
                        paraIdToCommentId.TryGetValue(parentParaId, out var parentId))
                    {
                        result[childId] = parentId;
                    }
                }

                if (result.Count > 0)
                    return result;
            }

            // Strategy 2: Positional matching — Nth entry maps to Nth comment
            // Build paraId -> commentId by position
            var positionalMap = new Dictionary<string, string>();
            for (int i = 0; i < Math.Min(entries.Count, comments.Count); i++)
            {
                var paraId = entries[i].Attribute(w15 + "paraId")?.Value;
                var commentId = comments[i].Id?.Value ?? "";
                if (paraId != null)
                    positionalMap[paraId] = commentId;
            }

            foreach (var entry in entries)
            {
                var paraId = entry.Attribute(w15 + "paraId")?.Value;
                var parentParaId = entry.Attribute(w15 + "paraIdParent")?.Value;
                if (paraId != null && parentParaId != null &&
                    positionalMap.TryGetValue(paraId, out var childId) &&
                    positionalMap.TryGetValue(parentParaId, out var parentId))
                {
                    result[childId] = parentId;
                }
            }
        }
        catch
        {
            // If commentsEx parsing fails, return empty — caller will use heuristic
        }

        return result;
    }

    private class CommentAnchor
    {
        public string AnchorText { get; set; } = "";
        public int ParagraphIndex { get; set; }
        public int StartOffset { get; set; }
        public int EndOffset { get; set; }
    }

    private Dictionary<string, CommentAnchor> BuildCommentAnchorMap(Body body, DocumentContent content)
    {
        var anchors = new Dictionary<string, CommentAnchor>();
        int paragraphIndex = 0;

        foreach (var element in body.ChildElements)
        {
            if (element is Paragraph para)
            {
                // Track character offset as we walk through the paragraph
                int charOffset = 0;
                var activeRanges = new Dictionary<string, int>(); // commentId -> startOffset

                foreach (var child in para.ChildElements)
                {
                    if (child is CommentRangeStart start)
                    {
                        var id = start.Id?.Value ?? "";
                        activeRanges[id] = charOffset;
                    }
                    else if (child is Run run)
                    {
                        // Skip field chars and field codes for offset calculation
                        var fieldChar = run.GetFirstChild<FieldChar>();
                        if (fieldChar != null) continue;
                        if (run.GetFirstChild<FieldCode>() != null) continue;
                        if (run.GetFirstChild<CommentReference>() != null) continue;

                        var text = run.GetFirstChild<Text>();
                        if (text != null)
                        {
                            charOffset += text.Text.Length;
                        }

                        var delText = run.GetFirstChild<DeletedText>();
                        if (delText != null)
                        {
                            // Don't count deleted text in offsets
                        }
                    }
                    else if (child is InsertedRun ins)
                    {
                        foreach (var insRun in ins.Elements<Run>())
                        {
                            var text = insRun.GetFirstChild<Text>();
                            if (text != null)
                                charOffset += text.Text.Length;
                        }
                    }
                    else if (child is CommentRangeEnd end)
                    {
                        var id = end.Id?.Value ?? "";
                        if (activeRanges.TryGetValue(id, out int startOff))
                        {
                            // Get the anchor text from the paragraph's full text
                            var paraText = GetParagraphText(para);
                            var anchorText = "";
                            if (startOff < paraText.Length)
                            {
                                var endOff = Math.Min(charOffset, paraText.Length);
                                anchorText = paraText[startOff..endOff];
                            }

                            anchors[id] = new CommentAnchor
                            {
                                AnchorText = anchorText,
                                ParagraphIndex = paragraphIndex,
                                StartOffset = startOff,
                                EndOffset = charOffset
                            };

                            activeRanges.Remove(id);
                        }
                    }
                }

                paragraphIndex++;
            }
        }

        return anchors;
    }

    private void ExtractTrackedChanges(Body body, DocumentContent content)
    {
        int paragraphIndex = 0;

        foreach (var element in body.ChildElements)
        {
            if (element is Paragraph para)
            {
                foreach (var child in para.ChildElements)
                {
                    if (child is InsertedRun ins)
                    {
                        var text = string.Join("",
                            ins.Elements<Run>()
                               .Select(r => r.GetFirstChild<Text>()?.Text ?? ""));

                        content.TrackedChanges.Add(new DocTrackedChange
                        {
                            ChangeType = "insertion",
                            Text = text,
                            Author = ins.Author?.Value ?? "",
                            Date = ins.Date?.Value,
                            ParagraphIndex = paragraphIndex,
                            RevisionId = ins.Id?.Value
                        });
                    }
                    else if (child is DeletedRun del)
                    {
                        var text = string.Join("",
                            del.Elements<Run>()
                               .Select(r => r.GetFirstChild<DeletedText>()?.Text ?? ""));

                        content.TrackedChanges.Add(new DocTrackedChange
                        {
                            ChangeType = "deletion",
                            Text = text,
                            Author = del.Author?.Value ?? "",
                            Date = del.Date?.Value,
                            ParagraphIndex = paragraphIndex,
                            RevisionId = del.Id?.Value
                        });
                    }
                }

                paragraphIndex++;
            }
        }
    }

    private void ExtractCitations(Body body, DocumentContent content)
    {
        int paragraphIndex = 0;

        foreach (var element in body.ChildElements)
        {
            if (element is Paragraph para)
            {
                ExtractCitationsFromParagraph(para, paragraphIndex, content);
                paragraphIndex++;
            }
        }
    }

    private void ExtractCitationsFromParagraph(Paragraph para, int paragraphIndex, DocumentContent content)
    {
        bool inField = false;
        string? currentFieldCode = null;
        string displayText = "";

        foreach (var child in para.ChildElements)
        {
            if (child is not Run run) continue;

            var fieldChar = run.GetFirstChild<FieldChar>();
            if (fieldChar != null)
            {
                if (fieldChar.FieldCharType?.Value == FieldCharValues.Begin)
                {
                    inField = true;
                    currentFieldCode = null;
                    displayText = "";
                }
                else if (fieldChar.FieldCharType?.Value == FieldCharValues.Separate)
                {
                    // Switch from code to display
                }
                else if (fieldChar.FieldCharType?.Value == FieldCharValues.End)
                {
                    // End of field — check if it's a citation
                    if (currentFieldCode != null && IsCitationField(currentFieldCode))
                    {
                        var paraText = GetParagraphText(para);
                        content.CitationFields.Add(new DocCitationField
                        {
                            CitationType = DetectCitationType(currentFieldCode),
                            RawFieldCode = currentFieldCode.Trim(),
                            DisplayText = displayText,
                            ParagraphIndex = paragraphIndex,
                            SurroundingText = paraText.Length > 200 ? paraText[..200] + "..." : paraText
                        });
                    }
                    inField = false;
                    currentFieldCode = null;
                }
                continue;
            }

            if (inField)
            {
                var fc = run.GetFirstChild<FieldCode>();
                if (fc != null)
                {
                    currentFieldCode = (currentFieldCode ?? "") + fc.Text;
                }

                var text = run.GetFirstChild<Text>();
                if (text != null && currentFieldCode != null)
                {
                    // We're past the Separate, in display text territory
                    displayText += text.Text;
                }
            }
        }
    }

    private bool IsCitationField(string fieldCode)
    {
        var upper = fieldCode.ToUpperInvariant();
        return upper.Contains("ZOTERO_ITEM") ||
               upper.Contains("ZOTERO_BIBL") ||
               upper.Contains("ENDNOTE") ||
               upper.Contains("MENDELEY") ||
               upper.Contains("CSL_CITATION") ||
               upper.Contains("CSL_BIBLIOGRAPHY");
    }

    private string DetectCitationType(string fieldCode)
    {
        var upper = fieldCode.ToUpperInvariant();
        if (upper.Contains("ZOTERO")) return "zotero";
        if (upper.Contains("ENDNOTE")) return "endnote";
        if (upper.Contains("MENDELEY")) return "mendeley";
        return "unknown";
    }

    private string ComputeHash(string text)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(text));
        return Convert.ToHexString(bytes)[..8].ToLowerInvariant();
    }
}
