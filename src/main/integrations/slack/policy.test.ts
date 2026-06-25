import { describe, it, expect } from 'vitest'
import {
  SLACK_POLICY_DEFAULTS,
  resolveSlackPolicy,
  parseSlackPolicyFields,
  type SlackConnectorPolicy,
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

describe('parseSlackPolicyFields', () => {
  it('returns defaults for undefined input', () => {
    expect(parseSlackPolicyFields(undefined)).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('returns defaults for null input', () => {
    expect(parseSlackPolicyFields(null)).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('returns defaults for non-object input', () => {
    expect(parseSlackPolicyFields('foo')).toEqual(SLACK_POLICY_DEFAULTS)
    expect(parseSlackPolicyFields(42)).toEqual(SLACK_POLICY_DEFAULTS)
    expect(parseSlackPolicyFields(true)).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('returns defaults for empty object', () => {
    expect(parseSlackPolicyFields({})).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('parses valid boolean fields', () => {
    expect(parseSlackPolicyFields({ aiEnabled: true })).toEqual({
      ...SLACK_POLICY_DEFAULTS,
      aiEnabled: true,
    })
  })

  it('ignores non-boolean values for boolean fields', () => {
    expect(parseSlackPolicyFields({ aiEnabled: 'yes' })).toEqual(SLACK_POLICY_DEFAULTS)
    expect(parseSlackPolicyFields({ sendEnabled: 1 })).toEqual(SLACK_POLICY_DEFAULTS)
    expect(parseSlackPolicyFields({ privateChannels: null })).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('parses all fields together', () => {
    const full: SlackConnectorPolicy = {
      aiEnabled: true,
      sendEnabled: true,
      privateChannels: true,
      directMessages: true,
    }
    expect(parseSlackPolicyFields(full)).toEqual(full)
  })

  it('ignores unknown fields', () => {
    expect(parseSlackPolicyFields({ aiEnabled: true, bogus: 'hi' })).toEqual({
      ...SLACK_POLICY_DEFAULTS,
      aiEnabled: true,
    })
  })
})

describe('resolveSlackPolicy', () => {
  it('returns defaults when no config layers have policy', () => {
    expect(resolveSlackPolicy(undefined, undefined)).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('uses user-global config when workspace has no override', () => {
    const userGlobal = { aiEnabled: true, sendEnabled: false }
    expect(resolveSlackPolicy(undefined, userGlobal)).toEqual({
      ...SLACK_POLICY_DEFAULTS,
      aiEnabled: true,
    })
  })

  it('uses workspace override when present', () => {
    const userGlobal = { aiEnabled: true }
    const workspace = { aiEnabled: false, sendEnabled: true }
    expect(resolveSlackPolicy(workspace, userGlobal)).toEqual({
      ...SLACK_POLICY_DEFAULTS,
      aiEnabled: false,
      sendEnabled: true,
    })
  })

  it('workspace override wins per-field, absent fields fall through to user-global', () => {
    const userGlobal = { aiEnabled: true, privateChannels: true }
    const workspace = { sendEnabled: true }
    expect(resolveSlackPolicy(workspace, userGlobal)).toEqual({
      aiEnabled: true,
      sendEnabled: true,
      privateChannels: true,
      directMessages: false,
    })
  })

  it('workspace override can disable a user-global enable', () => {
    const userGlobal = { aiEnabled: true }
    const workspace = { aiEnabled: false }
    expect(resolveSlackPolicy(workspace, userGlobal)).toEqual(SLACK_POLICY_DEFAULTS)
  })

  it('invalid values in both layers fall through to defaults', () => {
    const userGlobal = { aiEnabled: 'yes' }
    const workspace = { sendEnabled: 42 }
    expect(resolveSlackPolicy(workspace, userGlobal)).toEqual(SLACK_POLICY_DEFAULTS)
  })
})
