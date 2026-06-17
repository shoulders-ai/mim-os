import { describe, expect, it } from 'vitest'
import { ghostModels, providerConfigured, resolveGhostDefault, resolvePreferredModel } from './modelControls.js'

const haiku = {
  id: 'claude-haiku-4-5-20251001',
  name: 'Haiku 4.5',
  shortLabel: 'Haiku 4.5',
  provider: 'anthropic',
}
const flashLite = {
  id: 'gemini-3.1-flash-lite',
  name: 'Flash Lite',
  shortLabel: 'Flash-Lite',
  provider: 'google',
}
const nano = {
  id: 'gpt-5.4-nano',
  name: 'GPT-5.4 nano',
  shortLabel: 'GPT-5.4 nano',
  provider: 'openai',
}
const sonnet = { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'anthropic' }

const ghostOrder = ['claude-haiku-4-5-20251001', 'gemini-3.1-flash-lite', 'gpt-5.4-nano']

const fullRegistry = {
  models: [sonnet, haiku, flashLite, nano],
  defaults: { ghost: ghostOrder, inline: ['claude-sonnet-4-6', 'gemini-3.1-flash-lite', 'gpt-5.4-nano'] },
}

describe('ghostModels', () => {
  it('returns only ghost-eligible models from the registry', () => {
    const ids = ghostModels(fullRegistry).map((model) => model.id)
    expect(ids).toEqual([
      'claude-haiku-4-5-20251001',
      'gemini-3.1-flash-lite',
      'gpt-5.4-nano',
    ])
  })

  it('preserves priority order regardless of registry order', () => {
    const reversed = { models: [nano, flashLite, haiku], defaults: { ghost: ghostOrder } }
    const ids = ghostModels(reversed).map((model) => model.id)
    expect(ids).toEqual([
      'claude-haiku-4-5-20251001',
      'gemini-3.1-flash-lite',
      'gpt-5.4-nano',
    ])
  })

  it('attaches shortLabel to each model', () => {
    const result = ghostModels(fullRegistry)
    expect(result[0].shortLabel).toBe('Haiku 4.5')
    expect(result[1].shortLabel).toBe('Flash-Lite')
    expect(result[2].shortLabel).toBe('GPT-5.4 nano')
  })

  it('omits models not present in the registry', () => {
    const partial = { models: [flashLite], defaults: { ghost: ['gemini-3.1-flash-lite'] } }
    const result = ghostModels(partial)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gemini-3.1-flash-lite')
  })

  it('returns empty array for empty registry', () => {
    expect(ghostModels({ models: [] })).toEqual([])
    expect(ghostModels(null)).toEqual([])
    expect(ghostModels(undefined)).toEqual([])
  })
})

describe('resolveGhostDefault', () => {
  it('returns Haiku when Anthropic key is configured', () => {
    const keys = [
      { provider: 'anthropic', configured: true },
      { provider: 'google', configured: false },
      { provider: 'openai', configured: false },
    ]
    expect(resolveGhostDefault(fullRegistry, keys)?.id).toBe('claude-haiku-4-5-20251001')
  })

  it('returns Flash-Lite when only Google key is configured', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: true },
      { provider: 'openai', configured: false },
    ]
    expect(resolveGhostDefault(fullRegistry, keys)?.id).toBe('gemini-3.1-flash-lite')
  })

  it('returns GPT-5.4 nano when only OpenAI key is configured', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: false },
      { provider: 'openai', configured: true },
    ]
    expect(resolveGhostDefault(fullRegistry, keys)?.id).toBe('gpt-5.4-nano')
  })

  it('returns null when no keys are configured', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: false },
      { provider: 'openai', configured: false },
    ]
    expect(resolveGhostDefault(fullRegistry, keys)).toBeNull()
  })

  it('returns null for empty key statuses', () => {
    expect(resolveGhostDefault(fullRegistry, [])).toBeNull()
  })

  it('respects priority: Anthropic wins over Google when both configured', () => {
    const keys = [
      { provider: 'anthropic', configured: true },
      { provider: 'google', configured: true },
      { provider: 'openai', configured: false },
    ]
    expect(resolveGhostDefault(fullRegistry, keys)?.id).toBe('claude-haiku-4-5-20251001')
  })

  it('respects priority: Google wins over OpenAI when both configured and Anthropic is not configured', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: true },
      { provider: 'openai', configured: true },
    ]
    expect(resolveGhostDefault(fullRegistry, keys)?.id).toBe('gemini-3.1-flash-lite')
  })

  it('returns null when registry has no ghost models', () => {
    const noGhosts = { models: [sonnet] }
    const keys = [{ provider: 'anthropic', configured: true }]
    expect(resolveGhostDefault(noGhosts, keys)).toBeNull()
  })
})

describe('providerConfigured', () => {
  it('returns true when provider is configured', () => {
    expect(providerConfigured([{ provider: 'anthropic', configured: true }], 'anthropic')).toBe(true)
  })

  it('returns false when provider is not configured', () => {
    expect(providerConfigured([{ provider: 'anthropic', configured: false }], 'anthropic')).toBe(false)
  })

  it('returns false for unknown provider', () => {
    expect(providerConfigured([{ provider: 'anthropic', configured: true }], 'unknown')).toBe(false)
  })

  it('returns false for null or undefined provider', () => {
    const keys = [{ provider: 'anthropic', configured: true }]
    expect(providerConfigured(keys, null)).toBe(false)
    expect(providerConfigured(keys, undefined)).toBe(false)
  })

  it('returns false for null or undefined key statuses', () => {
    expect(providerConfigured(null, 'anthropic')).toBe(false)
    expect(providerConfigured(undefined, 'anthropic')).toBe(false)
  })
})

describe('resolvePreferredModel', () => {
  it('uses a configured stored model', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: true },
      { provider: 'openai', configured: false },
    ]
    expect(resolvePreferredModel(fullRegistry, keys, 'gemini-3.1-flash-lite', 'ghost')?.id).toBe('gemini-3.1-flash-lite')
  })

  it('falls back from an unconfigured stored model to the feature default with a key', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: true },
      { provider: 'openai', configured: false },
    ]
    expect(resolvePreferredModel(fullRegistry, keys, 'claude-haiku-4-5-20251001', 'ghost')?.id).toBe('gemini-3.1-flash-lite')
  })

  it('falls back from an unknown stored model to the feature default', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: false },
      { provider: 'openai', configured: true },
    ]
    expect(resolvePreferredModel(fullRegistry, keys, 'old-model-id', 'ghost')?.id).toBe('gpt-5.4-nano')
  })

  it('uses inline feature defaults when resolving inline rewrite models', () => {
    const keys = [
      { provider: 'anthropic', configured: false },
      { provider: 'google', configured: true },
      { provider: 'openai', configured: true },
    ]
    expect(resolvePreferredModel(fullRegistry, keys, '', 'inline')?.id).toBe('gemini-3.1-flash-lite')
  })
})
