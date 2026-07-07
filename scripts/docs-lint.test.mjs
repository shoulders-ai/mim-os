import { describe, it, expect } from 'vitest'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import {
  lintFile,
  loadToolNames,
  loadKbdCombos,
  loadSettingsSections,
  collectPageIds,
  collectManualFiles,
} from './docs-lint.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = resolve(dirname(fileURLToPath(import.meta.url)), '../.lint-test-scratch')

function setup() {
  mkdirSync(SCRATCH, { recursive: true })
}

function teardown() {
  if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true })
}

describe('docs-lint', () => {
  describe('lintFile — tool name validation', () => {
    it('reports unknown tool names', () => {
      setup()
      const file = resolve(SCRATCH, 'test-tools.md')
      writeFileSync(file, 'Use `fs.read` and `fake.tool` to do things.')
      const toolNames = new Set(['fs.read', 'fs.write'])
      const { errors } = lintFile(file, toolNames, new Set(), new Map(), new Set())
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('fake.tool')
      teardown()
    })

    it('does not flag known tool names', () => {
      setup()
      const file = resolve(SCRATCH, 'test-known.md')
      writeFileSync(file, 'Use `fs.read` and `git.status` here.')
      const toolNames = new Set(['fs.read', 'git.status'])
      const { errors } = lintFile(file, toolNames, new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })

    it('ignores file extensions like .md .ts', () => {
      setup()
      const file = resolve(SCRATCH, 'test-ext.md')
      writeFileSync(file, 'Edit `foo.md` and `bar.ts` and `mim.yaml`.')
      const toolNames = new Set(['fs.read'])
      const { errors } = lintFile(file, toolNames, new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })

    it('ignores version numbers', () => {
      setup()
      const file = resolve(SCRATCH, 'test-ver.md')
      writeFileSync(file, 'Version `0.1.5` is current.')
      const { errors } = lintFile(file, new Set(['fs.read']), new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })

    it('skips tool-name validation for manual/develop pages', () => {
      setup()
      mkdirSync(resolve(SCRATCH, 'manual/develop'), { recursive: true })
      const file = resolve(SCRATCH, 'manual/develop/sdk.md')
      writeFileSync(file, 'The SDK exposes `runtime.data` and `skills.disabled`.')
      const { errors } = lintFile(file, new Set(['fs.read']), new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })
  })

  describe('lintFile — kbd validation', () => {
    it('reports unknown kbd combos', () => {
      setup()
      const file = resolve(SCRATCH, 'test-kbd.md')
      writeFileSync(file, 'Press <kbd>Cmd+K</kbd> or <kbd>Cmd+Z+X</kbd>.')
      const kbdCombos = new Set(['Cmd+K'])
      const { errors } = lintFile(file, new Set(), kbdCombos, new Map(), new Set())
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Cmd+Z+X')
      teardown()
    })

    it('allows single keys without validation', () => {
      setup()
      const file = resolve(SCRATCH, 'test-single.md')
      writeFileSync(file, 'Press <kbd>Enter</kbd>.')
      const { errors } = lintFile(file, new Set(), new Set(['Cmd+K']), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })
  })

  describe('lintFile — settings section validation', () => {
    it('reports unknown settings sections', () => {
      setup()
      const file = resolve(SCRATCH, 'test-settings.md')
      writeFileSync(file, 'Go to Settings > Nonexistent to configure.')
      const labels = new Map([['Appearance', 'appearance'], ['AI & Models', 'ai']])
      const { errors } = lintFile(file, new Set(), new Set(), labels, new Set())
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('Nonexistent')
      teardown()
    })

    it('passes known settings sections', () => {
      setup()
      const file = resolve(SCRATCH, 'test-settings-ok.md')
      writeFileSync(file, 'Go to Settings > Appearance to change theme.')
      const labels = new Map([['Appearance', 'appearance']])
      const { errors } = lintFile(file, new Set(), new Set(), labels, new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })
  })

  describe('lintFile — link target validation', () => {
    it('reports unresolved internal links', () => {
      setup()
      const file = resolve(SCRATCH, 'test-links.md')
      writeFileSync(file, 'See [running code](running-code) and [missing](nonexistent).')
      const pageIds = new Set(['running-code'])
      const { errors } = lintFile(file, new Set(), new Set(), new Map(), pageIds)
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('nonexistent')
      teardown()
    })

    it('resolves /develop/ prefixed links', () => {
      setup()
      const file = resolve(SCRATCH, 'test-dev-links.md')
      writeFileSync(file, 'See [tool catalog](/develop/tools).')
      const pageIds = new Set(['tools'])
      const { errors } = lintFile(file, new Set(), new Set(), new Map(), pageIds)
      expect(errors).toHaveLength(0)
      teardown()
    })

    it('ignores external links', () => {
      setup()
      const file = resolve(SCRATCH, 'test-ext-links.md')
      writeFileSync(file, 'See [GitHub](https://github.com).')
      const { errors } = lintFile(file, new Set(), new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })

    it('ignores file path links with extensions', () => {
      setup()
      const file = resolve(SCRATCH, 'test-file-links.md')
      writeFileSync(file, 'See [docs](docs/security.md).')
      const { errors } = lintFile(file, new Set(), new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      teardown()
    })
  })

  describe('lintFile — TODO(verify) warnings', () => {
    it('reports TODO(verify) as warnings, not errors', () => {
      setup()
      const file = resolve(SCRATCH, 'test-todo.md')
      writeFileSync(file, 'This is correct TODO(verify: check the UI).')
      const { errors, warnings } = lintFile(file, new Set(), new Set(), new Map(), new Set())
      expect(errors).toHaveLength(0)
      expect(warnings).toHaveLength(1)
      expect(warnings[0].message).toContain('TODO(verify)')
      teardown()
    })
  })

  describe('loadToolNames (integration)', () => {
    it('loads real tool names from the headless kernel', () => {
      const names = loadToolNames()
      expect(names.size).toBeGreaterThan(50)
      expect(names.has('fs.read')).toBe(true)
      expect(names.has('web.search')).toBe(true)
    })
  })

  describe('loadKbdCombos (integration)', () => {
    it('loads real kbd combos from ShortcutsDialog.vue', () => {
      const combos = loadKbdCombos()
      expect(combos.size).toBeGreaterThan(10)
      expect(combos.has('Cmd+K')).toBe(true)
      expect(combos.has('Cmd+S')).toBe(true)
    })
  })

  describe('loadSettingsSections (integration)', () => {
    it('loads real settings sections', () => {
      const labels = loadSettingsSections()
      expect(labels.has('Appearance')).toBe(true)
      expect(labels.has('AI & Models')).toBe(true)
      expect(labels.has('Apps')).toBe(true)
    })
  })

  describe('collectPageIds (integration)', () => {
    it('collects page ids from manual files', () => {
      const ids = collectPageIds()
      // The manual _specs dir has files; actual chapter pages may not exist yet
      // but the generated develop pages will have ids after generation
      expect(ids).toBeInstanceOf(Set)
    })
  })

  describe('collectManualFiles (integration)', () => {
    it('finds markdown files in manual directories', () => {
      const files = collectManualFiles()
      expect(files.length).toBeGreaterThanOrEqual(0)
      // All returned paths should end with .md
      for (const f of files) {
        expect(f).toMatch(/\.md$/)
      }
    })
  })
})
