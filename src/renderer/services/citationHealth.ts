export interface CitationReference {
  key: string
}

export interface CitationOccurrence {
  key: string
  from: number
  to: number
}

export interface CitationHealth {
  enabled: boolean
  total: number
  unresolved: CitationOccurrence[]
  allResolved: boolean
}

const CITATION_KEY = /(^|[^\w])@([A-Za-z][\w:-]*)/g

export function computeCitationHealth(
  markdown: string,
  references: CitationReference[],
  enabled: boolean,
): CitationHealth {
  if (!enabled) {
    return { enabled: false, total: 0, unresolved: [], allResolved: true }
  }

  const known = new Set(references.map(reference => reference.key))
  const occurrences = citationOccurrences(markdown)
  const unresolved = occurrences.filter(item => !known.has(item.key))
  return {
    enabled: true,
    total: occurrences.length,
    unresolved,
    allResolved: unresolved.length === 0,
  }
}

export interface DocumentCitationGroup<R extends { key: string }> {
  key: string
  occurrences: CitationOccurrence[]
  reference: R | null
  resolved: boolean
}

// Distinct citation keys used in a document, each with every occurrence and its
// resolved reference. Unresolved keys sort first (the actionable ones); within
// each group document order is preserved because Array.prototype.sort is stable.
export function groupDocumentCitations<R extends { key: string }>(
  markdown: string,
  references: R[],
): Array<DocumentCitationGroup<R>> {
  const byKey = new Map<string, R>()
  for (const reference of references) byKey.set(reference.key, reference)

  const grouped = new Map<string, DocumentCitationGroup<R>>()
  const order: string[] = []
  for (const occurrence of citationOccurrences(markdown)) {
    let entry = grouped.get(occurrence.key)
    if (!entry) {
      const reference = byKey.get(occurrence.key) ?? null
      entry = { key: occurrence.key, occurrences: [], reference, resolved: reference !== null }
      grouped.set(occurrence.key, entry)
      order.push(occurrence.key)
    }
    entry.occurrences.push(occurrence)
  }

  return order
    .map(key => grouped.get(key)!)
    .sort((a, b) => (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1))
}

// The occurrence to jump to when navigating a citation key: the first one after
// `head`, wrapping back to the first so repeated jumps cycle through all uses.
export function nextCitationOccurrence(
  markdown: string,
  key: string,
  head: number,
): CitationOccurrence | null {
  const matching = citationOccurrences(markdown).filter(item => item.key === key)
  if (matching.length === 0) return null
  return matching.find(item => item.from > head) ?? matching[0]
}

export function citationOccurrences(markdown: string): CitationOccurrence[] {
  const out: CitationOccurrence[] = []
  let offset = 0
  let fence: string | null = null

  for (const line of markdown.split('\n')) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null
      }
      offset += line.length + 1
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      offset += line.length + 1
      continue
    }

    for (const segment of proseSegmentsOutsideInlineCode(line, offset)) {
      let match: RegExpExecArray | null
      CITATION_KEY.lastIndex = 0
      while ((match = CITATION_KEY.exec(segment.text)) !== null) {
        const prefixLength = match[1].length
        const from = segment.from + match.index + prefixLength
        out.push({
          key: match[2],
          from,
          to: from + match[2].length + 1,
        })
      }
    }
    offset += line.length + 1
  }

  return out
}

function proseSegmentsOutsideInlineCode(line: string, lineOffset: number): Array<{ text: string; from: number }> {
  const out: Array<{ text: string; from: number }> = []
  let plain = ''
  let plainFrom = lineOffset
  let i = 0

  while (i < line.length) {
    if (line[i] === '`') {
      let run = 1
      while (line[i + run] === '`') run++
      const ticks = '`'.repeat(run)
      const close = line.indexOf(ticks, i + run)
      if (close !== -1) {
        if (plain) out.push({ text: plain, from: plainFrom })
        plain = ''
        i = close + run
        plainFrom = lineOffset + i
        continue
      }
    }
    if (!plain) plainFrom = lineOffset + i
    plain += line[i]
    i++
  }
  if (plain) out.push({ text: plain, from: plainFrom })
  return out
}
