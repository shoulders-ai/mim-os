using System.Text.Json.Serialization;

namespace DocxWorker;

/// <summary>
/// Top-level container for all content extracted from a .docx file.
/// Designed for LLM readability — field names are self-describing.
/// </summary>
public class DocumentContent
{
    [JsonPropertyName("metadata")]
    public DocMetadata Metadata { get; set; } = new();

    [JsonPropertyName("paragraphs")]
    public List<DocParagraph> Paragraphs { get; set; } = new();

    [JsonPropertyName("tables")]
    public List<DocTable> Tables { get; set; } = new();

    [JsonPropertyName("comments")]
    public List<DocComment> Comments { get; set; } = new();

    [JsonPropertyName("trackedChanges")]
    public List<DocTrackedChange> TrackedChanges { get; set; } = new();

    [JsonPropertyName("citationFields")]
    public List<DocCitationField> CitationFields { get; set; } = new();

    [JsonPropertyName("totalParagraphs")]
    public int TotalParagraphs => Paragraphs.Count;

    [JsonPropertyName("totalTables")]
    public int TotalTables => Tables.Count;

    [JsonPropertyName("totalComments")]
    public int TotalComments => Comments.Count;
}

public class DocMetadata
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("author")]
    public string? Author { get; set; }

    [JsonPropertyName("createdDate")]
    public DateTime? CreatedDate { get; set; }

    [JsonPropertyName("modifiedDate")]
    public DateTime? ModifiedDate { get; set; }

    [JsonPropertyName("wordCount")]
    public int WordCount { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }
}

public class DocParagraph
{
    /// <summary>0-based sequential index among all body-level paragraphs.</summary>
    [JsonPropertyName("index")]
    public int Index { get; set; }

    /// <summary>The full plain-text content of the paragraph.</summary>
    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    /// <summary>Short hash for disambiguation (first 8 chars of SHA256 of text).</summary>
    [JsonPropertyName("contentHash")]
    public string ContentHash { get; set; } = "";

    /// <summary>First 80 chars of text, for quick identification.</summary>
    [JsonPropertyName("snippet")]
    public string Snippet { get; set; } = "";

    /// <summary>The OpenXml style ID (e.g., "Heading1", "ListParagraph", "Normal").</summary>
    [JsonPropertyName("styleId")]
    public string? StyleId { get; set; }

    /// <summary>Human-readable type: "heading-1", "heading-2", "bullet-list", "numbered-list", "normal".</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = "normal";

    /// <summary>Character count.</summary>
    [JsonPropertyName("characterCount")]
    public int CharacterCount => Text.Length;
}

public class DocTable
{
    /// <summary>0-based index among all tables in the document.</summary>
    [JsonPropertyName("tableIndex")]
    public int TableIndex { get; set; }

    /// <summary>Index of the paragraph position where this table appears in the document flow.</summary>
    [JsonPropertyName("positionAfterParagraphIndex")]
    public int PositionAfterParagraphIndex { get; set; }

    [JsonPropertyName("rowCount")]
    public int RowCount { get; set; }

    [JsonPropertyName("columnCount")]
    public int ColumnCount { get; set; }

    [JsonPropertyName("rows")]
    public List<DocTableRow> Rows { get; set; } = new();
}

public class DocTableRow
{
    [JsonPropertyName("rowIndex")]
    public int RowIndex { get; set; }

    [JsonPropertyName("cells")]
    public List<DocTableCell> Cells { get; set; } = new();
}

public class DocTableCell
{
    [JsonPropertyName("columnIndex")]
    public int ColumnIndex { get; set; }

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";
}

public class DocComment
{
    [JsonPropertyName("commentId")]
    public string CommentId { get; set; } = "";

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";

    [JsonPropertyName("date")]
    public DateTime? Date { get; set; }

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    /// <summary>The text in the document that this comment is anchored to.</summary>
    [JsonPropertyName("anchorText")]
    public string AnchorText { get; set; } = "";

    /// <summary>Paragraph index where the comment anchor starts.</summary>
    [JsonPropertyName("anchorParagraphIndex")]
    public int AnchorParagraphIndex { get; set; }

    /// <summary>Character offset within the paragraph where the anchor starts.</summary>
    [JsonPropertyName("anchorStartOffset")]
    public int AnchorStartOffset { get; set; }

    /// <summary>Character offset within the paragraph where the anchor ends.</summary>
    [JsonPropertyName("anchorEndOffset")]
    public int AnchorEndOffset { get; set; }

    /// <summary>If this is a reply, the ID of the parent comment. Null for top-level comments.</summary>
    [JsonPropertyName("replyToCommentId")]
    public string? ReplyToCommentId { get; set; }

    [JsonPropertyName("replies")]
    public List<DocComment> Replies { get; set; } = new();
}

public class DocTrackedChange
{
    /// <summary>"insertion" or "deletion"</summary>
    [JsonPropertyName("changeType")]
    public string ChangeType { get; set; } = "";

    [JsonPropertyName("text")]
    public string Text { get; set; } = "";

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";

    [JsonPropertyName("date")]
    public DateTime? Date { get; set; }

    [JsonPropertyName("paragraphIndex")]
    public int ParagraphIndex { get; set; }

    [JsonPropertyName("revisionId")]
    public string? RevisionId { get; set; }
}

public class DocCitationField
{
    /// <summary>"zotero", "endnote", "mendeley", or "unknown"</summary>
    [JsonPropertyName("citationType")]
    public string CitationType { get; set; } = "unknown";

    [JsonPropertyName("rawFieldCode")]
    public string RawFieldCode { get; set; } = "";

    [JsonPropertyName("displayText")]
    public string DisplayText { get; set; } = "";

    [JsonPropertyName("paragraphIndex")]
    public int ParagraphIndex { get; set; }

    /// <summary>Text surrounding the citation for context.</summary>
    [JsonPropertyName("surroundingText")]
    public string SurroundingText { get; set; } = "";
}

// ---- Writer result models ----

public class CommentResult
{
    [JsonPropertyName("commentId")]
    public string CommentId { get; set; } = "";

    [JsonPropertyName("usedNormalizedMatch")]
    public bool UsedNormalizedMatch { get; set; }

    [JsonPropertyName("matchedText")]
    public string MatchedText { get; set; } = "";
}

// ---- Writer operation models ----

public class WriteOperation
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";
}

public class AddCommentOperation
{
    [JsonPropertyName("paragraphIndex")]
    public int ParagraphIndex { get; set; }

    [JsonPropertyName("startCharOffset")]
    public int StartCharOffset { get; set; }

    [JsonPropertyName("endCharOffset")]
    public int EndCharOffset { get; set; }

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";

    [JsonPropertyName("commentText")]
    public string CommentText { get; set; } = "";
}

public class AddCommentReplyOperation
{
    [JsonPropertyName("parentCommentId")]
    public string ParentCommentId { get; set; } = "";

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";

    [JsonPropertyName("replyText")]
    public string ReplyText { get; set; } = "";
}

public class AddTrackedInsertionOperation
{
    [JsonPropertyName("paragraphIndex")]
    public int ParagraphIndex { get; set; }

    [JsonPropertyName("position")]
    public int Position { get; set; }

    [JsonPropertyName("textToInsert")]
    public string TextToInsert { get; set; } = "";

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";
}

public class AddTrackedDeletionOperation
{
    [JsonPropertyName("paragraphIndex")]
    public int ParagraphIndex { get; set; }

    [JsonPropertyName("startOffset")]
    public int StartOffset { get; set; }

    [JsonPropertyName("endOffset")]
    public int EndOffset { get; set; }

    [JsonPropertyName("author")]
    public string Author { get; set; } = "";
}

// === JSON Protocol Models ===

public class JsonRequest
{
    [JsonPropertyName("command")]
    public string Command { get; set; } = "";

    [JsonPropertyName("inputPath")]
    public string InputPath { get; set; } = "";

    [JsonPropertyName("outputPath")]
    public string? OutputPath { get; set; }

    [JsonPropertyName("operations")]
    public List<JsonOperation>? Operations { get; set; }
}

public class JsonOperation
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("anchorText")]
    public string? AnchorText { get; set; }

    [JsonPropertyName("author")]
    public string? Author { get; set; }

    [JsonPropertyName("commentText")]
    public string? CommentText { get; set; }

    [JsonPropertyName("occurrenceIndex")]
    public int? OccurrenceIndex { get; set; }

    [JsonPropertyName("parentCommentId")]
    public string? ParentCommentId { get; set; }

    [JsonPropertyName("replyText")]
    public string? ReplyText { get; set; }

    [JsonPropertyName("commentId")]
    public string? CommentId { get; set; }

    [JsonPropertyName("insertionText")]
    public string? InsertionText { get; set; }

    [JsonPropertyName("position")]
    public string? Position { get; set; }

    [JsonPropertyName("deleteText")]
    public string? DeleteText { get; set; }
}

public class JsonResponse
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("outputPath")]
    public string? OutputPath { get; set; }

    [JsonPropertyName("results")]
    public List<JsonOperationResult>? Results { get; set; }

    [JsonPropertyName("validationErrors")]
    public List<string>? ValidationErrors { get; set; }

    [JsonPropertyName("summary")]
    public JsonSummary? Summary { get; set; }

    // For read_comments
    [JsonPropertyName("comments")]
    public List<DocComment>? Comments { get; set; }

    [JsonPropertyName("trackedChanges")]
    public List<DocTrackedChange>? TrackedChanges { get; set; }

    [JsonPropertyName("metadata")]
    public DocMetadata? Metadata { get; set; }

    // For validate
    [JsonPropertyName("errors")]
    public List<string>? Errors { get; set; }
}

public class JsonOperationResult
{
    [JsonPropertyName("index")]
    public int Index { get; set; }

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("commentId")]
    public string? CommentId { get; set; }

    [JsonPropertyName("usedNormalizedMatch")]
    public bool? UsedNormalizedMatch { get; set; }

    [JsonPropertyName("matchedText")]
    public string? MatchedText { get; set; }
}

public class JsonSummary
{
    [JsonPropertyName("total")]
    public int Total { get; set; }

    [JsonPropertyName("succeeded")]
    public int Succeeded { get; set; }

    [JsonPropertyName("failed")]
    public int Failed { get; set; }
}
