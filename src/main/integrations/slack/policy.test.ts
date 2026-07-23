import { describe, it, expect } from 'vitest'
import {
  SLACK_POLICY_DEFAULTS,
} from './policy.js'

describe('SLACK_POLICY_DEFAULTS', () => {
  it('defaults are maximally restrictive', () => {
    expect(SLACK_POLICY_DEFAULTS).toEqual({
      aiEnabled: false,
      sendEnabled: false,
      privateChannels: false,
      directMessages: false,
    })
  })
})
