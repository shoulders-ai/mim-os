// Citation pipeline for document export. Markdown carries Pandoc-style
// citations ([@key], [@a; @b]); a BibTeX source resolves them to inline
// author-year or numeric labels plus a formatted bibliography. Output is
// renderer-neutral: inline labels are plain text spliced into the markdown,
// references are runs ({ text, italic }) both the HTML and DOCX renderers
// can consume without parsing markup.

import CSL from 'citeproc'

export interface BibEntry {
  key: string
  type: string
  fields: Record<string, string>
}

export interface Author {
  family: string
  given: string
}

export type CitationStyle = string

export interface CitationRenderOptions {
  styleXml?: string
}

const CSL_LOCALE_EN_US = `<?xml version="1.0" encoding="utf-8"?>
<locale xmlns="http://purl.org/net/xbiblio/csl" version="1.0" xml:lang="en-US">
  <terms>
    <term name="and">and</term>
    <term name="et-al">et al.</term>
    <term name="no date">n.d.</term>
    <term name="page">page</term>
    <term name="page" form="short">p.</term>
  </terms>
</locale>`

const CSL_STYLE_APA = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" default-locale="en-US">
  <info><title>Mim APA</title><id>mim-apa</id><updated>2026-01-01T00:00:00Z</updated></info>
  <macro name="author"><names variable="author"><name name-as-sort-order="all" initialize-with=". " delimiter=", " and="symbol"/></names></macro>
  <macro name="year"><date variable="issued"><date-part name="year"/></date></macro>
  <macro name="title"><choose><if type="book report thesis" match="any"><text variable="title" font-style="italic"/></if><else><text variable="title"/></else></choose></macro>
  <citation><layout prefix="(" suffix=")" delimiter="; "><group delimiter=", "><text macro="author"/><text macro="year"/></group></layout></citation>
  <bibliography>
    <sort><key macro="author"/><key macro="year"/></sort>
    <layout suffix="."><group delimiter=" "><text macro="author" suffix="."/><text macro="year" prefix="(" suffix=")."/><text macro="title" suffix="."/><group delimiter=", "><text variable="container-title" font-style="italic"/><text variable="volume" font-style="italic"/><text variable="issue" prefix="(" suffix=")"/><text variable="page"/></group><text variable="publisher"/><text variable="DOI" prefix="https://doi.org/"/><text variable="URL"/></group></layout>
  </bibliography>
</style>`

const CSL_STYLE_CHICAGO_AUTHOR_DATE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" default-locale="en-US">
  <info><title>Mim Chicago Author-Date</title><id>mim-chicago-author-date</id><updated>2026-01-01T00:00:00Z</updated></info>
  <macro name="author"><names variable="author"><name name-as-sort-order="first" delimiter=", " and="text"/></names></macro>
  <macro name="year"><date variable="issued"><date-part name="year"/></date></macro>
  <macro name="title"><choose><if type="article-journal paper-conference webpage" match="any"><text variable="title" quotes="true"/></if><else><text variable="title" font-style="italic"/></else></choose></macro>
  <citation><layout prefix="(" suffix=")" delimiter="; "><group delimiter=" "><text macro="author"/><text macro="year"/></group></layout></citation>
  <bibliography>
    <sort><key macro="author"/><key macro="year"/></sort>
    <layout suffix="."><group delimiter=" "><text macro="author" suffix="."/><text macro="year" suffix="."/><text macro="title" suffix="."/><group delimiter=" "><text variable="container-title" font-style="italic"/><text variable="volume"/><text variable="issue" prefix="(" suffix=")"/><text variable="page" prefix=":"/></group><text variable="publisher"/><text variable="DOI" prefix="https://doi.org/"/><text variable="URL"/></group></layout>
  </bibliography>
</style>`

const CSL_STYLE_IEEE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text" default-locale="en-US">
  <info><title>Mim IEEE</title><id>mim-ieee</id><updated>2026-01-01T00:00:00Z</updated></info>
  <citation collapse="citation-number"><layout prefix="[" suffix="]" delimiter=", "><text variable="citation-number"/></layout></citation>
  <bibliography>
    <layout><text variable="citation-number" prefix="[" suffix="] "/><names variable="author"><name initialize-with=". " delimiter=", " and="text"/></names><text variable="title" prefix=", &quot;" suffix=".&quot;"/><text variable="container-title" prefix=", " font-style="italic"/><text variable="volume" prefix=", vol. "/><text variable="issue" prefix=", no. "/><text variable="page" prefix=", pp. "/><date variable="issued" prefix=", "><date-part name="year"/></date><text variable="DOI" prefix=", doi: "/><text variable="URL" prefix=", "/><text value="."/></layout>
  </bibliography>
</style>`

export function builtinCitationStyleXml(style: string): string | null {
  if (style === 'apa') return CSL_STYLE_APA
  if (style === 'chicago' || style === 'chicago-author-date') return CSL_STYLE_CHICAGO_AUTHOR_DATE
  if (style === 'ieee') return CSL_STYLE_IEEE
  return null
}

export interface ReferenceRun {
  text: string
  italic?: boolean
}

export interface Reference {
  key: string
  /** IEEE list marker ("[1]"); absent for author-date styles. */
  label?: string
  runs: ReferenceRun[]
}

export interface ResolvedCitations {
  markdown: string
  /** Keys in order of first appearance — drives IEEE numbering. */
  usedKeys: string[]
  unresolvedKeys: string[]
}

// ── BibTeX parsing ─────────────────────────────────────────────────────

const SKIPPED_ENTRY_TYPES = new Set(['comment', 'string', 'preamble'])

export function parseBibtex(source: string): BibEntry[] {
  const entries: BibEntry[] = []
  let i = 0
  while (i < source.length) {
    const at = source.indexOf('@', i)
    if (at === -1) break
    const typeMatch = /^@([a-zA-Z]+)\s*[{(]/.exec(source.slice(at))
    if (!typeMatch) {
      i = at + 1
      continue
    }
    const type = typeMatch[1].toLowerCase()
    const bodyStart = at + typeMatch[0].length
    const body = readBalanced(source, bodyStart - 1)
    if (body === null) {
      i = at + 1
      continue
    }
    i = bodyStart - 1 + body.consumed
    if (SKIPPED_ENTRY_TYPES.has(type)) continue
    const entry = parseEntryBody(type, body.inner)
    if (entry) entries.push(entry)
  }
  return entries
}

// Read a {...} or (...) group starting at `open`, honoring nested braces.
function readBalanced(source: string, open: number): { inner: string; consumed: number } | null {
  const openChar = source[open]
  const closeChar = openChar === '{' ? '}' : ')'
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{' || (ch === openChar && openChar === '(' && depth === 0)) depth++
    else if (ch === '}' || (ch === closeChar && closeChar === ')' && depth === 1)) depth--
    if (depth === 0) return { inner: source.slice(open + 1, i), consumed: i - open + 1 }
  }
  return null
}

function parseEntryBody(type: string, body: string): BibEntry | null {
  const keyMatch = /^\s*([^,\s{}]+)\s*,/.exec(body)
  if (!keyMatch) return null
  const key = keyMatch[1]
  const fields: Record<string, string> = {}
  let i = keyMatch[0].length
  while (i < body.length) {
    const fieldMatch = /^[\s,]*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/.exec(body.slice(i))
    if (!fieldMatch) break
    const name = fieldMatch[1].toLowerCase()
    i += fieldMatch[0].length
    const value = readFieldValue(body, i)
    if (value === null) break
    fields[name] = cleanFieldValue(value.raw)
    i = value.end
  }
  return { key, type, fields }
}

function readFieldValue(body: string, start: number): { raw: string; end: number } | null {
  const ch = body[start]
  if (ch === '{') {
    const group = readBalanced(body, start)
    if (!group) return null
    return { raw: group.inner, end: start + group.consumed }
  }
  if (ch === '"') {
    for (let i = start + 1; i < body.length; i++) {
      if (body[i] === '"' && body[i - 1] !== '\\') return { raw: body.slice(start + 1, i), end: i + 1 }
    }
    return null
  }
  const bare = /^[^,{}]+/.exec(body.slice(start))
  if (!bare) return null
  return { raw: bare[0].trim(), end: start + bare[0].length }
}

// Strip LaTeX grouping braces and common escapes, normalize whitespace and
// double-dash ranges to en dashes.
function cleanFieldValue(raw: string): string {
  return raw
    .replace(/[{}]/g, '')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/---?/g, '–')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Author handling ────────────────────────────────────────────────────

const PARTICLES = new Set(['de', 'la', 'le', 'van', 'von', 'der', 'den', 'del', 'di', 'da', 'du', 'ter', 'ten'])

export function parseAuthors(field: string): Author[] {
  return field
    .split(/\s+and\s+/)
    .map(name => name.trim())
    .filter(Boolean)
    .map(parseAuthorName)
}

function parseAuthorName(name: string): Author {
  const comma = name.indexOf(',')
  if (comma !== -1) {
    return { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() }
  }
  const tokens = name.split(/\s+/)
  if (tokens.length === 1) return { family: tokens[0], given: '' }
  // Family begins at the first particle (von/de/la …) so "Bob de la Cruz"
  // keeps its full family name; otherwise the last token is the family.
  let familyStart = tokens.length - 1
  for (let i = 1; i < tokens.length - 1; i++) {
    if (PARTICLES.has(tokens[i].toLowerCase())) {
      familyStart = i
      break
    }
  }
  return { family: tokens.slice(familyStart).join(' '), given: tokens.slice(0, familyStart).join(' ') }
}

function initials(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map(part => `${part[0].toUpperCase()}.`)
    .join(' ')
}

export function formatAuthorsApa(authors: Author[]): string {
  const formatted = authors.map(a => (a.given ? `${a.family}, ${initials(a.given)}` : a.family))
  if (formatted.length === 1) return formatted[0]
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`
}

function createCslProcessor(entries: BibEntry[], styleXml: string) {
  const items = new Map(entries.map(entry => [entry.key, bibEntryToCslItem(entry)]))
  return new CSL.Engine({
    retrieveLocale: () => CSL_LOCALE_EN_US,
    retrieveItem: (id: string) => items.get(id),
  }, styleXml)
}

function bibEntryToCslItem(entry: BibEntry): Record<string, unknown> {
  const f = entry.fields
  const item: Record<string, unknown> = {
    id: entry.key,
    type: bibTypeToCslType(entry.type, f),
  }
  setCsl(item, 'title', f.title)
  setCsl(item, 'container-title', f.journal || f.booktitle)
  setCsl(item, 'publisher', f.publisher || f.institution || f.school || f.organization)
  setCsl(item, 'volume', f.volume)
  setCsl(item, 'issue', f.number)
  setCsl(item, 'page', f.pages)
  setCsl(item, 'DOI', f.doi)
  setCsl(item, 'URL', f.url)
  if (f.year) item.issued = { 'date-parts': [[Number.parseInt(f.year, 10) || f.year]] }
  if (f.author) item.author = parseAuthors(f.author).map(author => ({
    family: author.family,
    ...(author.given ? { given: author.given } : {}),
  }))
  if (f.editor) item.editor = parseAuthors(f.editor).map(author => ({
    family: author.family,
    ...(author.given ? { given: author.given } : {}),
  }))
  return item
}

function bibTypeToCslType(type: string, fields: Record<string, string>): string {
  if (type === 'book') return 'book'
  if (type === 'inproceedings' || type === 'conference') return 'paper-conference'
  if (type === 'incollection' || type === 'inbook') return 'chapter'
  if (type === 'phdthesis' || type === 'mastersthesis' || type === 'thesis') return 'thesis'
  if (type === 'techreport' || type === 'report') return 'report'
  if (fields.url && !fields.journal && !fields.booktitle) return 'webpage'
  return 'article-journal'
}

function setCsl(item: Record<string, unknown>, key: string, value: string | undefined): void {
  if (value && value.trim()) item[key] = value.trim()
}

function formatAuthorsIeee(authors: Author[]): string {
  const formatted = authors.map(a => (a.given ? `${initials(a.given)} ${a.family}` : a.family))
  if (formatted.length === 1) return formatted[0]
  return `${formatted.slice(0, -1).join(', ')} and ${formatted[formatted.length - 1]}`
}

function formatAuthorsChicago(authors: Author[]): string {
  const formatted = authors.map((a, i) => {
    if (i === 0) return a.given ? `${a.family}, ${a.given}` : a.family
    return a.given ? `${a.given} ${a.family}` : a.family
  })
  if (formatted.length === 1) return formatted[0]
  return `${formatted.slice(0, -1).join(', ')}, and ${formatted[formatted.length - 1]}`
}

// ── Inline citation resolution ─────────────────────────────────────────

const CITATION_GROUP = /\[@[A-Za-z0-9_][^\[\]]*\]/g
const CITATION_KEY = /@([A-Za-z0-9_][A-Za-z0-9_:.+/-]*)/g

export function resolveCitations(
  markdown: string,
  entries: BibEntry[],
  style: CitationStyle,
  options: CitationRenderOptions = {},
): ResolvedCitations {
  const byKey = new Map(entries.map(e => [e.key, e]))
  if (options.styleXml) return resolveCitationsWithCiteproc(markdown, entries, byKey, options.styleXml)
  const usedKeys: string[] = []
  const unresolved = new Set<string>()
  const numberFor = (key: string): number => {
    let index = usedKeys.indexOf(key)
    if (index === -1) {
      usedKeys.push(key)
      index = usedKeys.length - 1
    }
    return index + 1
  }

  const replaceInText = (text: string): string =>
    text.replace(CITATION_GROUP, (group) => {
      const keys = [...group.matchAll(CITATION_KEY)].map(m => m[1])
      if (keys.length === 0) return group
      const missing = keys.filter(k => !byKey.has(k))
      if (missing.length > 0) {
        for (const key of missing) unresolved.add(key)
        return group
      }
      return formatInlineCitation(keys, byKey, style, numberFor)
    })

  const markdownOut = mapOutsideCode(markdown, replaceInText)
  return { markdown: markdownOut, usedKeys, unresolvedKeys: [...unresolved] }
}

function resolveCitationsWithCiteproc(
  markdown: string,
  entries: BibEntry[],
  byKey: Map<string, BibEntry>,
  styleXml: string,
): ResolvedCitations {
  const usedKeys = citationKeysInOrder(markdown).filter(key => byKey.has(key))
  const unresolved = new Set(citationKeysInOrder(markdown).filter(key => !byKey.has(key)))
  if (usedKeys.length === 0) return { markdown, usedKeys, unresolvedKeys: [...unresolved] }
  const processor = createCslProcessor(entries, styleXml)
  processor.updateItems(usedKeys)
  const replaceInText = (text: string): string =>
    text.replace(CITATION_GROUP, (group) => {
      const keys = [...group.matchAll(CITATION_KEY)].map(m => m[1])
      if (keys.length === 0) return group
      const missing = keys.filter(k => !byKey.has(k))
      if (missing.length > 0) return group
      return decodeEntities(stripHtml(processor.makeCitationCluster(keys.map(id => ({ id })))))
    })
  return {
    markdown: mapOutsideCode(markdown, replaceInText),
    usedKeys,
    unresolvedKeys: [...unresolved],
  }
}

function citationKeysInOrder(markdown: string): string[] {
  const used: string[] = []
  mapOutsideCode(markdown, (text) => {
    text.replace(CITATION_GROUP, (group) => {
      for (const match of group.matchAll(CITATION_KEY)) {
        const key = match[1]
        if (!used.includes(key)) used.push(key)
      }
      return group
    })
    return text
  })
  return used
}

// Apply `transform` to prose only: fenced code blocks and inline code spans
// pass through verbatim.
function mapOutsideCode(markdown: string, transform: (text: string) => string): string {
  const lines = markdown.split('\n')
  let fence: string | null = null
  const out = lines.map((line) => {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      return line
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      return line
    }
    return mapOutsideInlineCode(line, transform)
  })
  return out.join('\n')
}

function mapOutsideInlineCode(line: string, transform: (text: string) => string): string {
  let result = ''
  let plain = ''
  let i = 0
  while (i < line.length) {
    if (line[i] === '`') {
      let run = 1
      while (line[i + run] === '`') run++
      const ticks = '`'.repeat(run)
      const close = line.indexOf(ticks, i + run)
      if (close !== -1) {
        result += transform(plain)
        plain = ''
        result += line.slice(i, close + run)
        i = close + run
        continue
      }
    }
    plain += line[i]
    i++
  }
  return result + transform(plain)
}

function formatInlineCitation(
  keys: string[],
  byKey: Map<string, BibEntry>,
  style: CitationStyle,
  numberFor: (key: string) => number,
): string {
  if (style === 'ieee') {
    return `[${keys.map(numberFor).join(', ')}]`
  }
  const parts = keys.map((key) => {
    numberFor(key)
    const entry = byKey.get(key)!
    const label = inlineAuthorLabel(entry)
    const year = entry.fields.year ?? 'n.d.'
    return style === 'apa' ? `${label}, ${year}` : `${label} ${year}`
  })
  return `(${parts.join('; ')})`
}

function inlineAuthorLabel(entry: BibEntry): string {
  const authors = entry.fields.author ? parseAuthors(entry.fields.author) : []
  if (authors.length === 0) return entry.fields.title ?? entry.key
  if (authors.length === 1) return authors[0].family
  if (authors.length === 2) return `${authors[0].family} & ${authors[1].family}`
  return `${authors[0].family} et al.`
}

// ── Bibliography ───────────────────────────────────────────────────────

export function buildBibliography(
  entries: BibEntry[],
  usedKeys: string[],
  style: CitationStyle,
  options: CitationRenderOptions = {},
): Reference[] {
  const byKey = new Map(entries.map(e => [e.key, e]))
  const used = usedKeys.filter(key => byKey.has(key))
  if (options.styleXml) return buildBibliographyWithCiteproc(entries, used, style, options.styleXml)

  if (style === 'ieee') {
    return used.map((key, index) => ({
      key,
      label: `[${index + 1}]`,
      runs: formatReference(byKey.get(key)!, 'ieee'),
    }))
  }

  const sorted = [...used].sort((a, b) => sortKey(byKey.get(a)!).localeCompare(sortKey(byKey.get(b)!)))
  return sorted.map(key => ({ key, runs: formatReference(byKey.get(key)!, style) }))
}

function buildBibliographyWithCiteproc(
  entries: BibEntry[],
  usedKeys: string[],
  style: CitationStyle,
  styleXml: string,
): Reference[] {
  if (usedKeys.length === 0) return []
  const processor = createCslProcessor(entries, styleXml)
  processor.updateItems(usedKeys)
  const bibliography = processor.makeBibliography()
  const params = bibliography?.[0] ?? {}
  const rendered = Array.isArray(bibliography?.[1]) ? bibliography[1] as string[] : []
  return rendered.map((html, index) => {
    const key = Array.isArray(params.entry_ids?.[index]) ? params.entry_ids[index][0] : usedKeys[index]
    const label = style === 'ieee' ? extractLeadingLabel(html) : undefined
    return {
      key,
      ...(label ? { label } : {}),
      runs: htmlToReferenceRuns(label ? html.replace(label, '') : html),
    }
  })
}

function htmlToReferenceRuns(html: string): ReferenceRun[] {
  const body = html
    .replace(/^\s*<div[^>]*>/i, '')
    .replace(/<\/div>\s*$/i, '')
  const runs: ReferenceRun[] = []
  let italic = false
  const re = /<\/?i\b[^>]*>|<[^>]+>|[^<]+/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    const token = match[0]
    if (/^<i\b/i.test(token)) {
      italic = true
      continue
    }
    if (/^<\/i/i.test(token)) {
      italic = false
      continue
    }
    if (token.startsWith('<')) continue
    const text = decodeEntities(token)
    if (text) runs.push({ text, ...(italic ? { italic: true } : {}) })
  }
  return runs.length > 0 ? runs : [{ text: decodeEntities(stripHtml(html)) }]
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#38;|&amp;/g, '&')
    .replace(/&#34;|&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
}

function extractLeadingLabel(html: string): string | undefined {
  const text = decodeEntities(stripHtml(html)).trim()
  return /^\[\d+\]/.exec(text)?.[0]
}

function sortKey(entry: BibEntry): string {
  const authors = entry.fields.author ? parseAuthors(entry.fields.author) : []
  const family = authors[0]?.family ?? entry.fields.title ?? entry.key
  return `${family} ${entry.fields.year ?? ''}`.toLowerCase()
}

function formatReference(entry: BibEntry, style: CitationStyle): ReferenceRun[] {
  if (style === 'apa') return formatReferenceApa(entry)
  if (style === 'chicago') return formatReferenceChicago(entry)
  return formatReferenceIeee(entry)
}

function linkOf(entry: BibEntry): string | null {
  if (entry.fields.doi) return `https://doi.org/${entry.fields.doi}`
  if (entry.fields.url) return entry.fields.url
  return null
}

function isArticle(entry: BibEntry): boolean {
  return Boolean(entry.fields.journal || entry.fields.booktitle)
}

function formatReferenceApa(entry: BibEntry): ReferenceRun[] {
  const f = entry.fields
  const authors = f.author ? formatAuthorsApa(parseAuthors(f.author)) : (f.title ?? entry.key)
  const year = f.year ?? 'n.d.'
  const link = linkOf(entry)
  const runs: ReferenceRun[] = [{ text: `${authors} (${year}). ` }]
  if (isArticle(entry)) {
    runs.push({ text: `${f.title ?? entry.key}. ` })
    runs.push({ text: f.journal ?? f.booktitle ?? '', italic: true })
    if (f.volume) {
      runs.push({ text: ', ' })
      runs.push({ text: f.volume, italic: true })
      if (f.number) runs.push({ text: `(${f.number})` })
      if (f.pages) runs.push({ text: `, ${f.pages}` })
      runs.push({ text: '.' })
    } else {
      runs.push({ text: '.' })
      if (f.pages) runs.push({ text: ` ${f.pages}.` })
    }
  } else {
    runs.push({ text: f.title ?? entry.key, italic: true })
    runs.push({ text: '.' })
    if (f.publisher) runs.push({ text: ` ${f.publisher}.` })
  }
  if (link) runs.push({ text: ` ${link}` })
  return runs
}

function formatReferenceChicago(entry: BibEntry): ReferenceRun[] {
  const f = entry.fields
  const authors = f.author ? formatAuthorsChicago(parseAuthors(f.author)) : (f.title ?? entry.key)
  const year = f.year ?? 'n.d.'
  const link = linkOf(entry)
  const runs: ReferenceRun[] = [{ text: `${authors}. ${year}. ` }]
  if (isArticle(entry)) {
    runs.push({ text: `“${f.title ?? entry.key}.” ` })
    runs.push({ text: f.journal ?? f.booktitle ?? '', italic: true })
    const locator = [f.volume, f.number ? `(${f.number})` : ''].filter(Boolean).join(' ')
    if (locator) runs.push({ text: ` ${locator}${f.pages ? `: ${f.pages}` : ''}.` })
    else runs.push({ text: '.' })
  } else {
    runs.push({ text: f.title ?? entry.key, italic: true })
    runs.push({ text: '.' })
    if (f.publisher) runs.push({ text: ` ${f.publisher}.` })
  }
  if (link) runs.push({ text: ` ${link}.` })
  return runs
}

function formatReferenceIeee(entry: BibEntry): ReferenceRun[] {
  const f = entry.fields
  const authors = f.author ? formatAuthorsIeee(parseAuthors(f.author)) : (f.title ?? entry.key)
  const year = f.year ?? 'n.d.'
  const link = linkOf(entry)
  const runs: ReferenceRun[] = []
  if (isArticle(entry)) {
    runs.push({ text: `${authors}, “${f.title ?? entry.key},” ` })
    runs.push({ text: f.journal ?? f.booktitle ?? '', italic: true })
    const locator = [
      f.volume ? `vol. ${f.volume}` : '',
      f.number ? `no. ${f.number}` : '',
      f.pages ? `pp. ${f.pages}` : '',
    ].filter(Boolean).join(', ')
    runs.push({ text: `${locator ? `, ${locator}` : ''}, ${year}.` })
  } else if (entry.type === 'book') {
    runs.push({ text: `${authors}, ` })
    runs.push({ text: f.title ?? entry.key, italic: true })
    runs.push({ text: `. ${f.publisher ? `${f.publisher}, ` : ''}${year}.` })
  } else {
    runs.push({ text: `${authors}, “${f.title ?? entry.key},” ${year}.` })
    if (f.url) runs.push({ text: ` [Online]. Available: ${f.url}` })
  }
  if (entry.type !== 'misc' && link && !f.url) runs.push({ text: ` ${link}` })
  else if (isArticle(entry) && link) runs.push({ text: ` ${link}` })
  return runs
}
