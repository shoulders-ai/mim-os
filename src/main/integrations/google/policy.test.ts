import { describe, expect, it } from 'vitest'
import {
  GOOGLE_POLICY_DEFAULTS,
  parseGooglePolicyFields,
  resolveGooglePolicy,
  type GoogleConnectorPolicy,
} from './policy.js'

describe('GOOGLE_POLICY_DEFAULTS', () => {
  it('defaults are maximally restrictive', () => {
    expect(GOOGLE_POLICY_DEFAULTS).toEqual({
      aiEnabled: false,
      gmailEnabled: false,
      gmailSendEnabled: false,
      calendarEnabled: false,
      calendarWriteEnabled: false,
      driveEnabled: false,
      sheetsWriteEnabled: false,
    })
  })
})

describe('parseGooglePolicyFields', () => {
  it('returns defaults for missing or invalid input', () => {
    expect(parseGooglePolicyFields(undefined)).toEqual(GOOGLE_POLICY_DEFAULTS)
    expect(parseGooglePolicyFields(null)).toEqual(GOOGLE_POLICY_DEFAULTS)
    expect(parseGooglePolicyFields('google')).toEqual(GOOGLE_POLICY_DEFAULTS)
    expect(parseGooglePolicyFields([])).toEqual(GOOGLE_POLICY_DEFAULTS)
  })

  it('parses valid boolean fields and ignores invalid values', () => {
    expect(parseGooglePolicyFields({
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: 'yes',
      calendarEnabled: true,
      calendarWriteEnabled: 1,
      driveEnabled: true,
      sheetsWriteEnabled: null,
      unknown: true,
    })).toEqual({
      ...GOOGLE_POLICY_DEFAULTS,
      aiEnabled: true,
      gmailEnabled: true,
      calendarEnabled: true,
      driveEnabled: true,
    })
  })

  it('parses all fields together', () => {
    const full: GoogleConnectorPolicy = {
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: true,
      calendarEnabled: true,
      calendarWriteEnabled: true,
      driveEnabled: true,
      sheetsWriteEnabled: true,
    }
    expect(parseGooglePolicyFields(full)).toEqual(full)
  })
})

describe('resolveGooglePolicy', () => {
  it('returns defaults when no config layers have policy', () => {
    expect(resolveGooglePolicy(undefined, undefined)).toEqual(GOOGLE_POLICY_DEFAULTS)
  })

  it('uses user-global config when workspace has no override', () => {
    expect(resolveGooglePolicy(undefined, {
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: true,
    })).toEqual({
      ...GOOGLE_POLICY_DEFAULTS,
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: true,
    })
  })

  it('workspace override wins per-field and absent fields fall through', () => {
    expect(resolveGooglePolicy(
      { gmailSendEnabled: false, calendarWriteEnabled: true },
      { aiEnabled: true, gmailEnabled: true, gmailSendEnabled: true, driveEnabled: true },
    )).toEqual({
      ...GOOGLE_POLICY_DEFAULTS,
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: false,
      calendarWriteEnabled: true,
      driveEnabled: true,
    })
  })

  it('workspace override can disable a user-global enable', () => {
    expect(resolveGooglePolicy(
      { aiEnabled: false, driveEnabled: false },
      { aiEnabled: true, driveEnabled: true },
    )).toEqual(GOOGLE_POLICY_DEFAULTS)
  })

  it('invalid values in both layers fall through to defaults', () => {
    expect(resolveGooglePolicy(
      { gmailEnabled: 'true', sheetsWriteEnabled: 1 },
      { aiEnabled: 'yes', driveEnabled: null },
    )).toEqual(GOOGLE_POLICY_DEFAULTS)
  })
})
