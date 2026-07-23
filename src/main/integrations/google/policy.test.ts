import { describe, expect, it } from 'vitest'
import {
  GOOGLE_POLICY_DEFAULTS,
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
