import mammoth from "mammoth";
import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) { console.error("Usage: node docx-read.mjs <file.docx>"); process.exit(1); }

// Use mammoth's internal reader to get comment metadata (author names, IDs)
const zipMod = await import("mammoth/lib/zipfile.js");
const docxReader = await import("mammoth/lib/docx/docx-reader.js");
const zip = await zipMod.openArrayBuffer(readFileSync(file));
const docResult = await docxReader.read(zip);
const internalComments = (docResult.value.comments || []).reduce((map, c) => {
  const text = extractTextFromBody(c.body);
  map[c.commentId] = { author: c.authorName || "Unknown", text };
  return map;
}, {});

const result = await mammoth.convertToHtml(
  { path: file },
  { styleMap: ["comment-reference => sup"] }
);

let html = result.value;

// Post-process: replace footnote-style comment refs with inline anchored markers
for (const [id, c] of Object.entries(internalComments)) {
  const refPattern = new RegExp(
    `<sup><a href="#comment-${id}" id="comment-ref-${id}">\\[\\d+\\]</a></sup>`
  );
  const inline = `«[Comment #${id} by ${c.author}: "${c.text}"]»`;
  html = html.replace(refPattern, inline);
}

// Strip the <dl> comment block at the end (now redundant)
html = html.replace(/<dl>.*<\/dl>/s, "");

const text = htmlToReadable(html);
console.log(text);

// Report stats to stderr
const warnings = [...new Set(result.messages.filter(m => m.type === "warning").map(m => m.message))];
if (warnings.length) {
  console.error(`\n--- ${warnings.length} mammoth warnings ---`);
  warnings.forEach(w => console.error("  " + w));
}

function extractTextFromBody(body) {
  if (!body) return "";
  return body.map(p =>
    (p.children || []).map(r =>
      (r.children || []).filter(c => c.type === "text").map(c => c.value).join("")
    ).join("")
  ).join(" ").trim();
}

function htmlToReadable(html) {
  let text = html;
  // Headings
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, t) => `\n# ${strip(t)}\n`);
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, t) => `\n## ${strip(t)}\n`);
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, t) => `\n### ${strip(t)}\n`);
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, (_, t) => `\n#### ${strip(t)}\n`);
  text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, (_, t) => `\n##### ${strip(t)}\n`);
  text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, (_, t) => `\n###### ${strip(t)}\n`);
  // Tables - keep as simple pipes
  text = text.replace(/<table[^>]*>/gi, "\n");
  text = text.replace(/<\/table>/gi, "\n");
  text = text.replace(/<tr[^>]*>/gi, "| ");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<t[dh][^>]*>/gi, "");
  text = text.replace(/<\/t[dh]>/gi, " | ");
  // Lists
  text = text.replace(/<ul[^>]*>/gi, "\n");
  text = text.replace(/<\/ul>/gi, "\n");
  text = text.replace(/<ol[^>]*>/gi, "\n");
  text = text.replace(/<\/ol>/gi, "\n");
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, t) => `- ${strip(t)}\n`);
  // Paragraphs and line breaks
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, (_, t) => `${strip(t)}\n\n`);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Images
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, "[Image: $1]");
  text = text.replace(/<img[^>]*>/gi, "[Image]");
  // Figures/captions
  text = text.replace(/<figure[^>]*>/gi, "\n");
  text = text.replace(/<\/figure>/gi, "\n");
  text = text.replace(/<figcaption[^>]*>(.*?)<\/figcaption>/gi, (_, t) => `Caption: ${strip(t)}\n`);
  // Bold/italic (keep as markdown)
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  // Strip remaining HTML
  text = text.replace(/<[^>]+>/g, "");
  // Decode entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#xa0;/g, " ").replace(/&nbsp;/g, " ");
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function strip(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#xa0;/g, " ").trim();
}
