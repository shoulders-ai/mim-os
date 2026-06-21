import { describe, expect, it } from 'vitest'
import { closeGuardDecision } from './closeGuard.js'

describe('closeGuardDecision', () => {
  it('does not prompt when no tabs are dirty', () => {
    expect(closeGuardDecision(0)).toEqual({ shouldPrompt: false, message: '' })
  })

  it('does not prompt for negative counts', () => {
    expect(closeGuardDecision(-1)).toEqual({ shouldPrompt: false, message: '' })
  })

  it('prompts for a single dirty tab with singular noun', () => {
    const result = closeGuardDecision(1)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 1 unsaved tab. Quit anyway?')
  })

  it('prompts for multiple dirty tabs with plural noun', () => {
    const result = closeGuardDecision(3)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 3 unsaved tabs. Quit anyway?')
  })

  it('prompts for active app runs only', () => {
    const result = closeGuardDecision(0, 2)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 2 active app runs. Quit anyway?')
  })

  it('prompts for a single active app run with singular noun', () => {
    const result = closeGuardDecision(0, 1)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 1 active app run. Quit anyway?')
  })

  it('combines dirty tabs and active runs in the message', () => {
    const result = closeGuardDecision(2, 3)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 2 unsaved tabs and 3 active app runs. Quit anyway?')
  })

  it('does not prompt when both counts are zero', () => {
    expect(closeGuardDecision(0, 0)).toEqual({ shouldPrompt: false, message: '' })
  })

  // --- agent sessions ---

  it('prompts for a single running agent session', () => {
    const result = closeGuardDecision(0, 0, 1)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 1 running agent session. Quit anyway?')
  })

  it('prompts for multiple running agent sessions with plural noun', () => {
    const result = closeGuardDecision(0, 0, 4)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 4 running agent sessions. Quit anyway?')
  })

  it('combines dirty tabs and agent sessions', () => {
    const result = closeGuardDecision(2, 0, 1)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 2 unsaved tabs and 1 running agent session. Quit anyway?')
  })

  it('combines active runs and agent sessions', () => {
    const result = closeGuardDecision(0, 3, 2)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 3 active app runs and 2 running agent sessions. Quit anyway?')
  })

  it('combines all three parts with comma and "and"', () => {
    const result = closeGuardDecision(2, 3, 1)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 2 unsaved tabs, 3 active app runs and 1 running agent session. Quit anyway?')
  })

  it('does not prompt when all three counts are zero', () => {
    expect(closeGuardDecision(0, 0, 0)).toEqual({ shouldPrompt: false, message: '' })
  })

  it('two-arg call shape still works (backward compat)', () => {
    const result = closeGuardDecision(1, 2)
    expect(result.shouldPrompt).toBe(true)
    expect(result.message).toBe('You have 1 unsaved tab and 2 active app runs. Quit anyway?')
  })
})
