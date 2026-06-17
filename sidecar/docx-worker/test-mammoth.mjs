import mammoth from "mammoth";
import { readFileSync } from "fs";
import { join } from "path";

const file = process.argv[2];
if (!file) { console.error("Usage: node test-mammoth.mjs <file.docx>"); process.exit(1); }

const result = await mammoth.convertToHtml({ path: file });
const html = result.value;
const warnings = result.messages.filter(m => m.type === "warning");

console.log("=== WARNINGS ===");
// deduplicate
const unique = [...new Set(warnings.map(w => w.message))];
unique.forEach(w => console.log("  " + w));
console.log(`\n${unique.length} unique warnings\n`);

console.log("=== STATS ===");
console.log(`HTML size: ${html.length} chars (~${Math.round(html.length/4)} tokens)`);
console.log(`Headings: ${(html.match(/<h[1-6]/g) || []).length}`);
console.log(`Tables: ${(html.match(/<table/g) || []).length}`);
console.log(`Table rows: ${(html.match(/<tr/g) || []).length}`);
console.log(`Images: ${(html.match(/<img/g) || []).length}`);
console.log(`Footnotes: ${(html.match(/footnote/gi) || []).length}`);
console.log(`Lists: ${(html.match(/<li/g) || []).length}`);

console.log("\n=== FIRST 3000 CHARS ===");
console.log(html.slice(0, 3000));

console.log("\n=== LAST 2000 CHARS ===");
console.log(html.slice(-2000));
