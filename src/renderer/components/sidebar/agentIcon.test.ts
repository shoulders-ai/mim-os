import { describe, expect, it } from 'vitest'
import { agentIconUrl } from './agentIcon.js'

describe('agentIconUrl', () => {
  it('provides a code-native Pi mark', () => {
    const icon = agentIconUrl('pi')
    expect(icon).toMatch(/^data:image\/svg\+xml,/)
    expect(decodeURIComponent(icon!)).toContain('<svg')
  })
})
