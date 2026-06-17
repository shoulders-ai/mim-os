import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import postcss, { type Rule } from 'postcss'

const here = dirname(fileURLToPath(import.meta.url))

function terminalStyles() {
  const source = readFileSync(join(here, 'TerminalPanel.vue'), 'utf8')
  const { descriptor } = parseSfc(source)
  return postcss.parse(descriptor.styles.map(style => style.content).join('\n'))
}

function ruleFor(selector: string): Rule {
  let match: Rule | null = null
  terminalStyles().walkRules(rule => {
    if (!match && rule.selector === selector) match = rule
  })
  if (!match) throw new Error(`Missing CSS rule for ${selector}`)
  return match
}

function declaration(rule: Rule, property: string) {
  const match = rule.nodes.find(node => node.type === 'decl' && node.prop === property)
  if (!match || match.type !== 'decl') throw new Error(`Missing ${property} declaration`)
  return { value: match.value, important: Boolean(match.important) }
}

describe('TerminalPanel chrome contracts', () => {
  it('hides xterm viewport scrollbars while keeping the terminal surface scrollable', () => {
    const viewportRule = ruleFor('.terminal-panel [data-tab-id] .xterm-viewport')
    const scrollbarRule = ruleFor('.terminal-panel [data-tab-id] .xterm-viewport::-webkit-scrollbar')

    expect(declaration(viewportRule, 'overflow-x')).toEqual({ value: 'hidden', important: true })
    expect(declaration(viewportRule, 'scrollbar-width')).toEqual({ value: 'none', important: false })
    expect(declaration(scrollbarRule, 'height')).toEqual({ value: '0', important: false })
  })
})
