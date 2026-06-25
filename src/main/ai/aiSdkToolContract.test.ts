import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'

type ViolationReason = 'legacyParameters' | 'missingInputSchema' | 'nonLiteralConfig'

interface Violation {
  file: string
  line: number
  column: number
  reason: ViolationReason
}

describe('AI SDK tool config contract', () => {
  it('detects legacy parameters and missing top-level inputSchema without matching nested keys', () => {
    const source = `
import { tool as aiTool } from 'ai'

const ok = aiTool({
  description: 'ok',
  inputSchema: z.object({
    parameters: z.string(),
  }),
  execute: async () => ({ parameters: true }),
})

const legacy = aiTool({ parameters: z.object({}), execute: async () => ({}) })
const missing = aiTool({ description: 'x', execute: async () => ({ inputSchema: true }) })
`

    const violations = collectAiSdkToolViolations('fixture.ts', source)

    expect(violations.map(violation => violation.reason)).toEqual([
      'legacyParameters',
      'missingInputSchema',
    ])
  })

  it('uses inputSchema for every production AI SDK tool definition', () => {
    const files = findProductionTypeScriptFiles(join(process.cwd(), 'src/main'))
    const violations = files.flatMap(file => {
      const displayFile = relative(process.cwd(), file).split(sep).join('/')
      return collectAiSdkToolViolations(displayFile, readFileSync(file, 'utf8'))
    })

    expect(formatViolations(violations)).toEqual([])
  })
})

function findProductionTypeScriptFiles(dir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findProductionTypeScriptFiles(fullPath))
      continue
    }

    if (!entry.isFile()) continue
    if (!entry.name.endsWith('.ts')) continue
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue
    files.push(fullPath)
  }

  return files
}

function collectAiSdkToolViolations(file: string, source: string): Violation[] {
  const toolNames = importedAiToolNames(source)
  if (!toolNames.length) return []

  const stripped = stripStringsAndComments(source)
  const toolCallPattern = new RegExp(`\\b(${toolNames.map(escapeRegExp).join('|')})\\s*\\(`, 'g')
  const violations: Violation[] = []

  for (const match of stripped.matchAll(toolCallPattern)) {
    const callStart = match.index ?? 0
    if (previousNonWhitespace(stripped, callStart - 1) === '.') continue

    const callee = match[1]
    const openParen = stripped.indexOf('(', callStart + callee.length)
    const configStart = nextNonWhitespace(stripped, openParen + 1)
    if (configStart < 0 || stripped[configStart] !== '{') {
      violations.push(violation(file, source, callStart, 'nonLiteralConfig'))
      continue
    }

    const configEnd = findMatchingBrace(stripped, configStart)
    if (configEnd < 0) {
      violations.push(violation(file, source, configStart, 'nonLiteralConfig'))
      continue
    }

    const properties = topLevelPropertyPositions(source, stripped, configStart, configEnd)
    const parametersIndex = properties.get('parameters')
    if (parametersIndex !== undefined) {
      violations.push(violation(file, source, parametersIndex, 'legacyParameters'))
      continue
    }

    if (!properties.has('inputSchema')) {
      violations.push(violation(file, source, configStart, 'missingInputSchema'))
    }
  }

  return violations
}

function importedAiToolNames(source: string): string[] {
  const names = new Set<string>()
  const importPattern = /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?{([\s\S]*?)}\s*from\s*['"]ai['"]/g

  for (const match of source.matchAll(importPattern)) {
    for (const specifier of match[1].split(',')) {
      const trimmed = specifier.trim()
      if (!trimmed || trimmed.startsWith('type ')) continue

      const alias = /^tool(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(trimmed)
      if (alias) names.add(alias[1] ?? 'tool')
    }
  }

  return Array.from(names)
}

function stripStringsAndComments(source: string): string {
  let output = ''
  let index = 0

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index + 2)
      const stop = end < 0 ? source.length : end
      output += blankPreservingNewlines(source.slice(index, stop))
      index = stop
      continue
    }

    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end < 0 ? source.length : end + 2
      output += blankPreservingNewlines(source.slice(index, stop))
      index = stop
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      const stop = findStringEnd(source, index, char)
      output += blankPreservingNewlines(source.slice(index, stop))
      index = stop
      continue
    }

    output += char
    index += 1
  }

  return output
}

function findStringEnd(source: string, start: number, quote: string): number {
  let index = start + 1

  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2
      continue
    }
    if (source[index] === quote) return index + 1
    index += 1
  }

  return source.length
}

function blankPreservingNewlines(value: string): string {
  return value.replace(/[^\n]/g, ' ')
}

function previousNonWhitespace(source: string, start: number): string | undefined {
  for (let index = start; index >= 0; index -= 1) {
    if (!/\s/.test(source[index])) return source[index]
  }
  return undefined
}

function nextNonWhitespace(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (!/\s/.test(source[index])) return index
  }
  return -1
}

function findMatchingBrace(source: string, start: number): number {
  let depth = 0

  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
      continue
    }

    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function topLevelPropertyPositions(source: string, stripped: string, objectStart: number, objectEnd: number): Map<string, number> {
  const properties = new Map<string, number>()
  let segmentStart = objectStart + 1
  let braceDepth = 0
  let bracketDepth = 0
  let parenDepth = 0

  for (let index = objectStart + 1; index < objectEnd; index += 1) {
    const char = stripped[index]

    if (char === '{') braceDepth += 1
    else if (char === '}') braceDepth -= 1
    else if (char === '[') bracketDepth += 1
    else if (char === ']') bracketDepth -= 1
    else if (char === '(') parenDepth += 1
    else if (char === ')') parenDepth -= 1
    else if (char === ',' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      addPropertyPosition(properties, source, stripped, segmentStart, index)
      segmentStart = index + 1
    }
  }

  addPropertyPosition(properties, source, stripped, segmentStart, objectEnd)
  return properties
}

function addPropertyPosition(properties: Map<string, number>, source: string, stripped: string, start: number, end: number): void {
  const strippedSegment = stripped.slice(start, end)
  const firstCodeOffset = strippedSegment.search(/\S/)
  if (firstCodeOffset < 0) return

  const propertyStart = start + firstCodeOffset
  const originalSegment = source.slice(propertyStart, end)
  const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(originalSegment)
  if (!match) return

  properties.set(match[1], propertyStart)
}

function violation(file: string, source: string, index: number, reason: ViolationReason): Violation {
  const { line, column } = lineAndColumn(source, index)
  return { file, line, column, reason }
}

function lineAndColumn(source: string, index: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0

  for (let offset = 0; offset < index; offset += 1) {
    if (source[offset] === '\n') {
      line += 1
      lineStart = offset + 1
    }
  }

  return { line, column: index - lineStart + 1 }
}

function formatViolations(violations: Violation[]): string[] {
  return violations.map(violation => {
    const label = `${violation.file}:${violation.line}:${violation.column}`
    if (violation.reason === 'legacyParameters') return `${label} uses parameters in an AI SDK tool() config; use inputSchema`
    if (violation.reason === 'missingInputSchema') return `${label} is missing inputSchema in an AI SDK tool() config`
    return `${label} uses a non-literal AI SDK tool() config; inline the object so this guard can inspect inputSchema`
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
