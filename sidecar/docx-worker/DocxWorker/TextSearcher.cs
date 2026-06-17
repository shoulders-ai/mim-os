using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Wordprocessing;

namespace DocxWorker;

/// <summary>
/// Finds text across fragmented runs in .docx paragraphs.
/// Bridges the gap between what the LLM sees (flat text) and where OpenXml
/// needs to anchor operations (runs + character offsets).
/// </summary>
public class TextSearchResult
{
    public int ParagraphIndex { get; set; }
    public int StartCharOffset { get; set; }
    public int EndCharOffset { get; set; }
    public string FoundText { get; set; } = "";
    public string ParagraphText { get; set; } = "";
}

public class TextSearcher
{
    /// <summary>
    /// Find exact text match across all paragraphs in the document body.
    /// Returns null if not found.
    /// </summary>
    public TextSearchResult? FindText(Body body, string searchText)
    {
        if (string.IsNullOrEmpty(searchText))
            return null;

        var paragraphs = body.Descendants<Paragraph>().ToList();
        for (int i = 0; i < paragraphs.Count; i++)
        {
            var paraText = GetParagraphPlainText(paragraphs[i]);
            int idx = paraText.IndexOf(searchText, StringComparison.Ordinal);
            if (idx >= 0)
            {
                return new TextSearchResult
                {
                    ParagraphIndex = i,
                    StartCharOffset = idx,
                    EndCharOffset = idx + searchText.Length,
                    FoundText = paraText.Substring(idx, searchText.Length),
                    ParagraphText = paraText
                };
            }
        }

        return null;
    }

    /// <summary>
    /// Find text with normalized whitespace (collapse multiple spaces, trim).
    /// </summary>
    public TextSearchResult? FindTextNormalized(Body body, string searchText)
    {
        if (string.IsNullOrEmpty(searchText))
            return null;

        var normalizedSearch = NormalizeWhitespace(searchText);

        var paragraphs = body.Descendants<Paragraph>().ToList();
        for (int i = 0; i < paragraphs.Count; i++)
        {
            var paraText = GetParagraphPlainText(paragraphs[i]);
            var normalizedPara = NormalizeWhitespace(paraText);
            int idx = normalizedPara.IndexOf(normalizedSearch, StringComparison.Ordinal);
            if (idx >= 0)
            {
                // Map normalized offset back to original text offset
                var (origStart, origEnd) = MapNormalizedOffsetToOriginal(paraText, normalizedPara, idx, idx + normalizedSearch.Length);
                return new TextSearchResult
                {
                    ParagraphIndex = i,
                    StartCharOffset = origStart,
                    EndCharOffset = origEnd,
                    FoundText = paraText[origStart..origEnd],
                    ParagraphText = paraText
                };
            }
        }

        return null;
    }

    /// <summary>
    /// Find all occurrences of exact text across all paragraphs.
    /// </summary>
    public List<TextSearchResult> FindAllOccurrences(Body body, string searchText)
    {
        var results = new List<TextSearchResult>();
        if (string.IsNullOrEmpty(searchText))
            return results;

        var paragraphs = body.Descendants<Paragraph>().ToList();
        for (int i = 0; i < paragraphs.Count; i++)
        {
            var paraText = GetParagraphPlainText(paragraphs[i]);
            int startIdx = 0;
            while (true)
            {
                int idx = paraText.IndexOf(searchText, startIdx, StringComparison.Ordinal);
                if (idx < 0) break;

                results.Add(new TextSearchResult
                {
                    ParagraphIndex = i,
                    StartCharOffset = idx,
                    EndCharOffset = idx + searchText.Length,
                    FoundText = paraText.Substring(idx, searchText.Length),
                    ParagraphText = paraText
                });

                startIdx = idx + 1;
            }
        }

        return results;
    }

    /// <summary>
    /// Get the concatenated plain text of a paragraph, handling fragmented runs,
    /// skipping field codes, including inserted text, excluding deleted text,
    /// and walking into hyperlinks.
    /// </summary>
    public string GetParagraphPlainText(Paragraph para)
    {
        var sb = new System.Text.StringBuilder();
        bool inFieldCode = false;

        CollectTextFromChildren(para, sb, ref inFieldCode);

        return sb.ToString();
    }

    /// <summary>
    /// Recursively collects text from child elements, handling runs, hyperlinks,
    /// insertions, deletions, and field codes.
    /// </summary>
    private void CollectTextFromChildren(OpenXmlElement parent, System.Text.StringBuilder sb, ref bool inFieldCode)
    {
        foreach (var child in parent.ChildElements)
        {
            if (child is Run run)
            {
                CollectTextFromRun(run, sb, ref inFieldCode);
            }
            else if (child is Hyperlink hyperlink)
            {
                // Walk inside hyperlinks to get run text
                foreach (var hlChild in hyperlink.Elements<Run>())
                {
                    CollectTextFromRun(hlChild, sb, ref inFieldCode);
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
            // CommentRangeStart, CommentRangeEnd, BookmarkStart, BookmarkEnd — skip
        }
    }

    private void CollectTextFromRun(Run run, System.Text.StringBuilder sb, ref bool inFieldCode)
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
            return;
        }

        // Skip field code content (the actual field instruction text)
        if (inFieldCode && run.GetFirstChild<FieldCode>() != null)
            return;

        // Skip CommentReference runs
        if (run.GetFirstChild<CommentReference>() != null)
            return;

        // Regular text — include unless we're inside a field code
        var text = run.GetFirstChild<Text>();
        if (text != null && !inFieldCode)
        {
            sb.Append(text.Text);
        }
        // Display text inside fields (after Separate, before End) - inFieldCode is false here
        else if (text != null && !inFieldCode)
        {
            sb.Append(text.Text);
        }
    }

    private static string NormalizeWhitespace(string text)
    {
        var sb = new System.Text.StringBuilder(text.Length);
        bool lastWasSpace = false;
        foreach (char c in text.Trim())
        {
            if (char.IsWhiteSpace(c))
            {
                if (!lastWasSpace)
                {
                    sb.Append(' ');
                    lastWasSpace = true;
                }
            }
            else
            {
                sb.Append(c);
                lastWasSpace = false;
            }
        }
        return sb.ToString();
    }

    /// <summary>
    /// Maps character offsets from normalized text back to the original text.
    /// </summary>
    private static (int origStart, int origEnd) MapNormalizedOffsetToOriginal(
        string original, string normalized, int normStart, int normEnd)
    {
        // Walk both strings in parallel, tracking the mapping
        int origIdx = 0;
        int normIdx = 0;
        int origStart = 0;
        int origEnd = original.Length;

        // Skip leading whitespace in original (since normalized is trimmed)
        while (origIdx < original.Length && char.IsWhiteSpace(original[origIdx]))
            origIdx++;

        while (normIdx < normalized.Length && origIdx < original.Length)
        {
            if (normIdx == normStart)
                origStart = origIdx;
            if (normIdx == normEnd)
            {
                origEnd = origIdx;
                break;
            }

            if (char.IsWhiteSpace(normalized[normIdx]))
            {
                // Normalized has a single space; original may have multiple
                normIdx++;
                origIdx++;
                while (origIdx < original.Length && char.IsWhiteSpace(original[origIdx]))
                    origIdx++;
            }
            else
            {
                normIdx++;
                origIdx++;
            }
        }

        if (normIdx == normEnd)
            origEnd = origIdx;

        return (origStart, origEnd);
    }
}
