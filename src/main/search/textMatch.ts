export interface TextMatch {
  index: number
  length: number
}

interface NormalizedChar {
  value: string
  start: number
  end: number
}

export function findTextMatches(text: string, query: string): TextMatch[] {
  if (!text || !query) return []

  const exact = findExactMatches(text, query)
  if (exact.length > 0) return exact

  const normalizedText = normalizeForMatch(text)
  const normalizedQuery = normalizeForMatch(query)
  const normalizedNeedle = normalizedQuery.chars.map(c => c.value).join('')
  if (!normalizedNeedle) return []

  return findExactMatches(
    normalizedText.chars.map(c => c.value).join(''),
    normalizedNeedle,
  ).map((match) => {
    const start = normalizedText.chars[match.index]?.start
    const last = normalizedText.chars[match.index + match.length - 1]
    if (start == null || !last) return null
    return { index: start, length: last.end - start }
  }).filter((match): match is TextMatch => Boolean(match))
}

export function countTextMatches(text: string, query: string): number {
  return findTextMatches(text, query).length
}

function findExactMatches(text: string, query: string): TextMatch[] {
  const matches: TextMatch[] = []
  let index = text.indexOf(query)
  while (index !== -1) {
    matches.push({ index, length: query.length })
    index = text.indexOf(query, index + query.length)
  }
  return matches
}

function normalizeForMatch(value: string): { chars: NormalizedChar[] } {
  const chars: NormalizedChar[] = []
  let i = 0

  while (i < value.length) {
    const char = value[i]
    const next = value[i + 1]

    if (char === '\r' && next === '\n') {
      pushWhitespace(chars, i, i + 2)
      i += 2
      continue
    }

    if (isWhitespace(char)) {
      const start = i
      i += 1
      while (i < value.length && isWhitespace(value[i])) i += 1
      pushWhitespace(chars, start, i)
      continue
    }

    const mapped = mapTypographicChar(char)
    for (const output of mapped) {
      chars.push({ value: output, start: i, end: i + 1 })
    }
    i += 1
  }

  return { chars }
}

function pushWhitespace(chars: NormalizedChar[], start: number, end: number): void {
  const last = chars[chars.length - 1]
  if (last?.value === ' ') {
    last.end = end
  } else {
    chars.push({ value: ' ', start, end })
  }
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

function mapTypographicChar(char: string): string {
  switch (char) {
    case '\u2018':
    case '\u2019':
    case '\u201A':
    case '\u201B':
      return "'"
    case '\u201C':
    case '\u201D':
    case '\u201E':
    case '\u201F':
      return '"'
    case '\u2013':
    case '\u2014':
      return '--'
    case '\u2026':
      return '...'
    default:
      return char
  }
}
