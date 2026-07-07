// Shortcuts fragment generator.
// Extracts keyboard shortcuts from ShortcutsDialog.vue (the same source the
// in-app dialog reads) and emits manual/_generated/shortcuts.md as a markdown
// fragment (no frontmatter — it is an include, not a page).

import { readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Parse the shortcut sections from ShortcutsDialog.vue.
 * Returns an array of { title, shortcuts: [{ keys, label }] }.
 *
 * The .vue file defines `const sections = [...]` with shortcutLabel([...])
 * calls. We parse the data structure from the source rather than importing
 * the .vue file (which requires the Vue compiler).
 */
export function parseShortcutsFromVue(source) {
  // Extract the `const sections = [...]` block. It ends at the matching `]`.
  const startMatch = source.match(/const sections\s*=\s*\[/)
  if (!startMatch) throw new Error('Could not find sections array in ShortcutsDialog.vue')

  const startIdx = startMatch.index + startMatch[0].length - 1
  let depth = 0
  let endIdx = startIdx
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '[') depth++
    else if (source[i] === ']') {
      depth--
      if (depth === 0) { endIdx = i + 1; break }
    }
  }

  const sectionsSource = source.slice(startIdx, endIdx)

  // Parse section titles
  const titleMatches = [...sectionsSource.matchAll(/title:\s*'([^']+)'/g)]

  // Parse shortcuts: each { keys: shortcutLabel([...]), label: '...' }
  const sections = []
  const sectionBlocks = sectionsSource.split(/\{\s*title:/).slice(1)

  for (let i = 0; i < sectionBlocks.length; i++) {
    const block = sectionBlocks[i]
    const title = titleMatches[i]?.[1] ?? 'Unknown'

    // Find all shortcut entries. The array inside shortcutLabel([...]) may
    // contain ']' as a key value, so we cannot use [^\]]+ to match. Instead,
    // match everything between shortcutLabel([ and the next ]), then the label.
    const shortcuts = []
    const entryRegex = /shortcutLabel\(\[((?:'[^']*'(?:\s*,\s*)?)+)\]\)\s*,\s*label:\s*'([^']+)'/g
    let m
    while ((m = entryRegex.exec(block)) !== null) {
      const rawKeys = m[1]
      const label = m[2]
      // Parse the key parts from the array literal
      const parts = rawKeys.match(/'([^']*?)'/g)?.map(k => k.replace(/'/g, '')) ?? []
      shortcuts.push({ parts, label })
    }

    sections.push({ title, shortcuts })
  }

  return sections
}

/**
 * Convert raw key parts to macOS <kbd> form.
 * Uses the same logic as shortcutLabels.ts for macOS.
 */
export function partsToKbd(parts) {
  const macOrder = ['Ctrl', 'Alt', 'Shift', 'Mod']
  const modifiers = parts.filter(p => macOrder.includes(p))
  const rest = parts.filter(p => !macOrder.includes(p))
  const ordered = [
    ...macOrder.filter(p => modifiers.includes(p)),
    ...rest,
  ]
  const labels = ordered.map(p => {
    if (p === 'Mod') return 'Cmd'
    if (p === 'Shift') return 'Shift'
    if (p === 'Alt') return 'Option'
    if (p === 'Ctrl') return 'Ctrl'
    if (p === 'Enter') return 'Enter'
    if (p === 'Tab') return 'Tab'
    return p
  })
  return `<kbd>${labels.join('+')}</kbd>`
}

/**
 * Generate the markdown fragment for keyboard shortcuts.
 * No frontmatter (it's an include fragment).
 */
export function generateShortcutsMarkdown(sections) {
  const lines = []

  for (const section of sections) {
    lines.push(`## ${section.title.toLowerCase()}`)
    lines.push('')
    lines.push('| shortcut | action |')
    lines.push('|---|---|')
    for (const s of section.shortcuts) {
      lines.push(`| ${partsToKbd(s.parts)} | ${s.label} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Extract all kbd combos from the generated shortcuts. Useful for lint.
 * Returns a Set of kbd strings like "Cmd+K", "Ctrl+Tab", etc.
 */
export function extractAllKbdCombos(sections) {
  const combos = new Set()
  for (const section of sections) {
    for (const s of section.shortcuts) {
      const macOrder = ['Ctrl', 'Alt', 'Shift', 'Mod']
      const modifiers = s.parts.filter(p => macOrder.includes(p))
      const rest = s.parts.filter(p => !macOrder.includes(p))
      const ordered = [
        ...macOrder.filter(p => modifiers.includes(p)),
        ...rest,
      ]
      const labels = ordered.map(p => {
        if (p === 'Mod') return 'Cmd'
        if (p === 'Shift') return 'Shift'
        if (p === 'Alt') return 'Option'
        if (p === 'Ctrl') return 'Ctrl'
        if (p === 'Enter') return 'Enter'
        if (p === 'Tab') return 'Tab'
        return p
      })
      combos.add(labels.join('+'))
    }
  }
  return combos
}

/**
 * Main entry point: generate and write the shortcuts fragment.
 */
export function generateShortcuts() {
  const vuePath = resolve(ROOT, 'src/renderer/components/ShortcutsDialog.vue')
  const source = readFileSync(vuePath, 'utf-8')
  const sections = parseShortcutsFromVue(source)
  const markdown = generateShortcutsMarkdown(sections)
  const outPath = resolve(ROOT, 'manual/_generated/shortcuts.md')
  writeFileSync(outPath, markdown, 'utf-8')
  return { path: outPath, sectionCount: sections.length, shortcutCount: sections.reduce((n, s) => n + s.shortcuts.length, 0) }
}
