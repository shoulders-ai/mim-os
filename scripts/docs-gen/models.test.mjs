import { describe, it, expect } from 'vitest'
import {
  loadModelsCatalog,
  groupModelsByProvider,
  formatContextWindow,
  formatPricing,
  formatCapabilities,
  generateModelsMarkdown,
} from './models.mjs'

describe('models', () => {
  describe('formatContextWindow', () => {
    it('formats millions', () => {
      expect(formatContextWindow(1_000_000)).toBe('1M')
      expect(formatContextWindow(1_048_576)).toBe('1.05M')
      expect(formatContextWindow(1_050_000)).toBe('1.05M')
    })
    it('formats thousands', () => {
      expect(formatContextWindow(200_000)).toBe('200K')
    })
    it('formats small numbers', () => {
      expect(formatContextWindow(512)).toBe('512')
    })
  })

  describe('formatPricing', () => {
    it('formats input/output pricing', () => {
      expect(formatPricing({ inputPerMillion: 2.0, outputPerMillion: 10.0 })).toBe('$2/$10')
    })
    it('returns dash for null', () => {
      expect(formatPricing(null)).toBe('-')
    })
  })

  describe('formatCapabilities', () => {
    it('lists true capabilities', () => {
      const result = formatCapabilities({ text: true, json: true, vision: false })
      expect(result).toContain('text')
      expect(result).toContain('json')
      expect(result).not.toContain('vision')
    })
    it('returns dash for null', () => {
      expect(formatCapabilities(null)).toBe('-')
    })
  })

  describe('groupModelsByProvider', () => {
    it('groups models by provider field', () => {
      const models = [
        { provider: 'anthropic', name: 'A' },
        { provider: 'openai', name: 'B' },
        { provider: 'anthropic', name: 'C' },
      ]
      const groups = groupModelsByProvider(models)
      expect(groups.get('anthropic')).toHaveLength(2)
      expect(groups.get('openai')).toHaveLength(1)
    })
  })

  describe('generateModelsMarkdown', () => {
    const minimalCatalog = {
      version: 1,
      providers: {
        anthropic: { url: 'https://api.anthropic.com/v1/messages', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      defaults: {
        chat: ['claude-sonnet-5'],
      },
      models: [
        {
          id: 'claude-sonnet-5',
          name: 'Claude Sonnet 5',
          displayName: 'Claude Sonnet 5',
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          contextWindow: 1_000_000,
          capabilities: { text: true, json: true },
          pricing: { inputPerMillion: 2.0, outputPerMillion: 10.0 },
          control: { kind: 'effort', default: 'medium' },
        },
      ],
    }

    it('emits valid frontmatter', () => {
      const md = generateModelsMarkdown(minimalCatalog)
      expect(md).toContain('id: models')
      expect(md).toContain('title: models')
      expect(md).toContain('generated: true')
    })

    it('includes providers table', () => {
      const md = generateModelsMarkdown(minimalCatalog)
      expect(md).toContain('| anthropic |')
      expect(md).toContain('`ANTHROPIC_API_KEY`')
    })

    it('includes defaults table', () => {
      const md = generateModelsMarkdown(minimalCatalog)
      expect(md).toContain('| chat |')
      expect(md).toContain('`claude-sonnet-5`')
    })

    it('includes model table with all columns', () => {
      const md = generateModelsMarkdown(minimalCatalog)
      expect(md).toContain('standard input/output rates')
      expect(md).toContain('cache and long-context pricing')
      expect(md).toContain('| model | context | pricing (in/out) | capabilities | control |')
      expect(md).toContain('Claude Sonnet 5')
      expect(md).toContain('1M')
      expect(md).toContain('$2/$10')
    })
  })

  describe('loadModelsCatalog (integration)', () => {
    it('loads the real models catalog', () => {
      const catalog = loadModelsCatalog()
      expect(catalog.models.length).toBeGreaterThan(5)
      expect(catalog.providers).toHaveProperty('anthropic')
      expect(catalog.providers).toHaveProperty('openai')
      expect(catalog.providers).toHaveProperty('google')
    })
  })
})
