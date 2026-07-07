import { describe, it, expect } from 'vitest'
import {
  groupByNamespace,
  formatEffect,
  deriveToolMeta,
  generateToolCatalogMarkdown,
  loadToolList,
  loadGateModule,
  parseToolPolicies,
  parseEffectOverrides,
  categoryEffect,
  buildGateModule,
} from './toolCatalog.mjs'

describe('toolCatalog', () => {
  describe('groupByNamespace', () => {
    it('groups tools by the prefix before the first dot', () => {
      const tools = [
        { name: 'fs.read', description: 'Read' },
        { name: 'fs.write', description: 'Write' },
        { name: 'git.status', description: 'Status' },
        { name: 'search', description: 'Search' },
      ]
      const groups = groupByNamespace(tools)
      expect(groups.get('fs')).toHaveLength(2)
      expect(groups.get('git')).toHaveLength(1)
      expect(groups.get('core')).toHaveLength(1)
    })
  })

  describe('formatEffect', () => {
    it('bolds mutate', () => {
      expect(formatEffect('mutate')).toBe('**mutate**')
    })
    it('leaves read plain', () => {
      expect(formatEffect('read')).toBe('read')
    })
    it('leaves external plain', () => {
      expect(formatEffect('external')).toBe('external')
    })
  })

  describe('parseToolPolicies', () => {
    it('parses policy entries from gate source', () => {
      const source = `
        const TOOL_POLICIES = {
          'fs.read': { category: 'read', risk: 'low', pathParam: 'path' },
          'fs.write': { category: 'write', risk: 'medium', pathParam: 'path' },
          'web.search': { category: 'network', risk: 'medium', targetParam: 'query' },
        }
      `
      const policies = parseToolPolicies(source)
      expect(policies.get('fs.read')).toEqual({ category: 'read', risk: 'low' })
      expect(policies.get('fs.write')).toEqual({ category: 'write', risk: 'medium' })
      expect(policies.get('web.search')).toEqual({ category: 'network', risk: 'medium' })
    })
  })

  describe('parseEffectOverrides', () => {
    it('parses overrides from gate source', () => {
      const source = `
        const EFFECT_OVERRIDES: Record<string, ToolEffect> = {
          'settings.get': 'read',
          'google.exchangeCode': 'external',
        }
      `
      const overrides = parseEffectOverrides(source)
      expect(overrides.get('settings.get')).toBe('read')
      expect(overrides.get('google.exchangeCode')).toBe('external')
    })
  })

  describe('categoryEffect', () => {
    it('maps read/search/ai to read', () => {
      expect(categoryEffect('read')).toBe('read')
      expect(categoryEffect('search')).toBe('read')
      expect(categoryEffect('ai')).toBe('read')
    })
    it('maps network to external', () => {
      expect(categoryEffect('network')).toBe('external')
    })
    it('maps write/system/settings/ui/general to mutate', () => {
      expect(categoryEffect('write')).toBe('mutate')
      expect(categoryEffect('system')).toBe('mutate')
      expect(categoryEffect('settings')).toBe('mutate')
      expect(categoryEffect('ui')).toBe('mutate')
      expect(categoryEffect('general')).toBe('mutate')
    })
  })

  describe('buildGateModule', () => {
    const source = `
      const TOOL_POLICIES = {
        'fs.read': { category: 'read', risk: 'low' },
        'fs.write': { category: 'write', risk: 'medium' },
        'web.search': { category: 'network', risk: 'medium' },
        'settings.get': { category: 'settings', risk: 'low' },
      }
      const EFFECT_OVERRIDES: Record<string, ToolEffect> = {
        'settings.get': 'read',
      }
    `
    const gate = buildGateModule(source)

    it('resolves effect correctly from policies', () => {
      expect(gate.toolEffect('fs.read')).toBe('read')
      expect(gate.toolEffect('fs.write')).toBe('mutate')
      expect(gate.toolEffect('web.search')).toBe('external')
    })

    it('applies effect overrides', () => {
      expect(gate.toolEffect('settings.get')).toBe('read')
    })

    it('defaults unknown tools to mutate', () => {
      expect(gate.toolEffect('unknown.tool')).toBe('mutate')
    })
  })

  describe('generateToolCatalogMarkdown', () => {
    const fakeGateModule = {
      toolEffect: (name) => {
        if (name === 'fs.read') return 'read'
        if (name === 'fs.write') return 'mutate'
        if (name === 'web.search') return 'external'
        return 'read'
      },
      getToolPolicy: (name) => {
        if (name === 'fs.read') return { category: 'read', risk: 'low' }
        if (name === 'fs.write') return { category: 'write', risk: 'medium' }
        if (name === 'web.search') return { category: 'network', risk: 'medium' }
        return { category: 'general', risk: 'low' }
      },
    }

    it('emits valid frontmatter with generated: true', () => {
      const md = generateToolCatalogMarkdown([
        { name: 'fs.read', description: 'Read a file' },
      ], fakeGateModule)
      expect(md).toContain('id: tools')
      expect(md).toContain('title: tool catalog')
      expect(md).toContain('generated: true')
    })

    it('groups tools by namespace with h2 headers', () => {
      const md = generateToolCatalogMarkdown([
        { name: 'fs.read', description: 'Read' },
        { name: 'web.search', description: 'Search' },
      ], fakeGateModule)
      expect(md).toContain('## fs')
      expect(md).toContain('## web')
    })

    it('formats effect column: mutate is bold, others plain', () => {
      const md = generateToolCatalogMarkdown([
        { name: 'fs.read', description: 'Read' },
        { name: 'fs.write', description: 'Write' },
        { name: 'web.search', description: 'Search' },
      ], fakeGateModule)
      expect(md).toContain('| read |')
      expect(md).toContain('| **mutate** |')
      expect(md).toContain('| external |')
    })

    it('sets approval to auto for read, ask for mutate and external', () => {
      const md = generateToolCatalogMarkdown([
        { name: 'fs.read', description: 'Read' },
        { name: 'fs.write', description: 'Write' },
        { name: 'web.search', description: 'Search' },
      ], fakeGateModule)
      expect(md).toMatch(/`fs\.read`.*auto/)
      expect(md).toMatch(/`fs\.write`.*ask/)
      expect(md).toMatch(/`web\.search`.*ask/)
    })

    it('contains table header row', () => {
      const md = generateToolCatalogMarkdown([
        { name: 'fs.read', description: 'Read' },
      ], fakeGateModule)
      expect(md).toContain('| tool | description | effect | approval |')
    })

    it('escapes pipe characters in descriptions', () => {
      const md = generateToolCatalogMarkdown([
        { name: 'fs.read', description: 'Read | Write' },
      ], fakeGateModule)
      expect(md).toContain('Read \\| Write')
    })
  })

  describe('deriveToolMeta', () => {
    const fakeGateModule = {
      toolEffect: (name) => name === 'fs.read' ? 'read' : 'mutate',
      getToolPolicy: () => ({ category: 'read', risk: 'low' }),
    }

    it('returns auto approval for read effect', () => {
      const meta = deriveToolMeta('fs.read', fakeGateModule)
      expect(meta.approvalDefault).toBe('auto')
    })

    it('returns ask approval for mutate effect', () => {
      const meta = deriveToolMeta('fs.write', fakeGateModule)
      expect(meta.approvalDefault).toBe('ask')
    })
  })

  describe('loadToolList (integration)', () => {
    it('loads real tools from the built headless kernel', () => {
      const tools = loadToolList()
      expect(tools.length).toBeGreaterThan(50)
      expect(tools[0]).toHaveProperty('name')
      expect(tools[0]).toHaveProperty('description')
      const fsRead = tools.find(t => t.name === 'fs.read')
      expect(fsRead).toBeDefined()
    })
  })

  describe('loadGateModule (integration)', () => {
    it('loads the gate module from gate.ts source with correct effects', () => {
      const gate = loadGateModule()
      expect(gate.toolEffect).toBeTypeOf('function')
      expect(gate.getToolPolicy).toBeTypeOf('function')
      expect(gate.toolEffect('fs.read')).toBe('read')
      expect(gate.toolEffect('fs.write')).toBe('mutate')
      expect(gate.toolEffect('web.search')).toBe('external')
    })
  })
})
