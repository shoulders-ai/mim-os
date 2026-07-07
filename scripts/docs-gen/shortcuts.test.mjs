import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  parseShortcutsFromVue,
  partsToKbd,
  generateShortcutsMarkdown,
  extractAllKbdCombos,
} from './shortcuts.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('shortcuts', () => {
  describe('partsToKbd', () => {
    it('renders Mod as Cmd for macOS', () => {
      expect(partsToKbd(['Mod', 'K'])).toBe('<kbd>Cmd+K</kbd>')
    })

    it('renders Alt as Option for macOS', () => {
      expect(partsToKbd(['Mod', 'Alt', '→'])).toBe('<kbd>Option+Cmd+→</kbd>')
    })

    it('orders modifiers: Ctrl, Alt/Option, Shift, Cmd', () => {
      expect(partsToKbd(['Shift', 'Mod', 'S'])).toBe('<kbd>Shift+Cmd+S</kbd>')
    })

    it('renders Ctrl+Tab correctly', () => {
      expect(partsToKbd(['Ctrl', 'Tab'])).toBe('<kbd>Ctrl+Tab</kbd>')
    })

    it('renders Ctrl+Shift+Tab correctly', () => {
      expect(partsToKbd(['Ctrl', 'Shift', 'Tab'])).toBe('<kbd>Ctrl+Shift+Tab</kbd>')
    })
  })

  describe('parseShortcutsFromVue', () => {
    const realSource = readFileSync(
      resolve(ROOT, 'src/renderer/components/ShortcutsDialog.vue'),
      'utf-8',
    )

    it('extracts all sections from the real source', () => {
      const sections = parseShortcutsFromVue(realSource)
      expect(sections).toHaveLength(4)
      expect(sections.map(s => s.title)).toEqual(['General', 'Navigation', 'Editor', 'Review & suggestions'])
    })

    it('extracts correct shortcuts from the General section', () => {
      const sections = parseShortcutsFromVue(realSource)
      const general = sections[0]
      expect(general.shortcuts.length).toBeGreaterThanOrEqual(7)
      const settings = general.shortcuts.find(s => s.label === 'Settings')
      expect(settings).toBeDefined()
      expect(settings.parts).toEqual(['Mod', ','])
    })

    it('extracts correct shortcuts from the Navigation section', () => {
      const sections = parseShortcutsFromVue(realSource)
      const nav = sections[1]
      expect(nav.shortcuts.length).toBeGreaterThanOrEqual(4)
      const back = nav.shortcuts.find(s => s.label.includes('Back'))
      expect(back).toBeDefined()
      expect(back.parts).toEqual(['Mod', '['])
    })

    it('parses ] as a key value inside the shortcutLabel array', () => {
      const sections = parseShortcutsFromVue(realSource)
      const nav = sections[1]
      const forward = nav.shortcuts.find(s => s.label.includes('Forward'))
      expect(forward).toBeDefined()
      expect(forward.parts).toEqual(['Mod', ']'])
    })

    it('extracts correct shortcuts from the Editor section', () => {
      const sections = parseShortcutsFromVue(realSource)
      const editor = sections[2]
      expect(editor.shortcuts.length).toBeGreaterThanOrEqual(11)
      const save = editor.shortcuts.find(s => s.label === 'Save file')
      expect(save).toBeDefined()
      expect(save.parts).toEqual(['Mod', 'S'])
    })
  })

  describe('generateShortcutsMarkdown', () => {
    it('emits lowercase h2 group headings', () => {
      const sections = [{ title: 'General', shortcuts: [{ parts: ['Mod', 'K'], label: 'Test' }] }]
      const md = generateShortcutsMarkdown(sections)
      expect(md).toContain('## general')
    })

    it('emits a table per section', () => {
      const sections = [
        { title: 'General', shortcuts: [{ parts: ['Mod', 'K'], label: 'Test' }] },
        { title: 'Editor', shortcuts: [{ parts: ['Mod', 'S'], label: 'Save' }] },
      ]
      const md = generateShortcutsMarkdown(sections)
      const tables = md.split('| shortcut | action |').length - 1
      expect(tables).toBe(2)
    })

    it('has no frontmatter', () => {
      const sections = [{ title: 'General', shortcuts: [{ parts: ['Mod', 'K'], label: 'Test' }] }]
      const md = generateShortcutsMarkdown(sections)
      // Frontmatter starts with --- on the first line; the fragment must not
      expect(md.startsWith('---')).toBe(false)
    })

    it('uses <kbd> form for shortcuts', () => {
      const sections = [{ title: 'General', shortcuts: [{ parts: ['Mod', 'K'], label: 'Inline AI' }] }]
      const md = generateShortcutsMarkdown(sections)
      expect(md).toContain('<kbd>Cmd+K</kbd>')
    })
  })

  describe('extractAllKbdCombos', () => {
    it('returns a Set of all key combos', () => {
      const sections = [
        { title: 'General', shortcuts: [
          { parts: ['Mod', 'K'], label: 'Test' },
          { parts: ['Mod', 'S'], label: 'Save' },
        ]},
      ]
      const combos = extractAllKbdCombos(sections)
      expect(combos.has('Cmd+K')).toBe(true)
      expect(combos.has('Cmd+S')).toBe(true)
    })
  })
})
