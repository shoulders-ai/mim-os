import { describe, it, expect } from 'vitest'
import { decideLanding } from './landingDecision.js'

describe('decideLanding', () => {
  it('lands on chat draft when there is no active session', () => {
    expect(decideLanding(null)).toEqual({ target: 'chat-draft' })
  })

  it('resumes the last active session when one exists', () => {
    expect(decideLanding('sess-42')).toEqual({
      target: 'last-session',
      sessionId: 'sess-42',
    })
  })

  it('lands on chat draft for empty string session id', () => {
    expect(decideLanding('')).toEqual({ target: 'chat-draft' })
  })
})
