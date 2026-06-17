import { describe, it, expect } from 'vitest'
import { chatErrorActions, readableError } from './chatErrorActions.js'

describe('chatErrorActions', () => {
  it('returns null when there is no error', () => {
    expect(chatErrorActions(null)).toBeNull()
    expect(chatErrorActions(undefined)).toBeNull()
  })

  it('no key configured → Open Settings only (Retry would be a dead end)', () => {
    const a = chatErrorActions(new Error('No AI model available. Check your API keys in Settings.'), false)
    expect(a?.kind).toBe('auth')
    expect(a?.showOpenSettings).toBe(true)
    expect(a?.showRetry).toBe(false)
    expect(a?.message).toContain('Open Settings')
  })

  it('rejected key with a key configured → Open Settings AND Retry', () => {
    const a = chatErrorActions(new Error('API returned 401 Unauthorized'), true)
    expect(a?.kind).toBe('auth')
    expect(a?.showOpenSettings).toBe(true)
    expect(a?.showRetry).toBe(true)
  })

  it('transient rate-limit error → Retry, not Open Settings', () => {
    const a = chatErrorActions(new Error('429 rate limit'), true)
    expect(a?.kind).toBe('limit')
    expect(a?.showRetry).toBe(true)
    expect(a?.showOpenSettings).toBe(false)
  })

  it('network error → Retry only', () => {
    const a = chatErrorActions(new Error('fetch failed'), false)
    expect(a?.showRetry).toBe(true)
    expect(a?.showOpenSettings).toBe(false)
  })

  it('keeps the original message for unrecognized errors', () => {
    const a = chatErrorActions(new Error('Failed to load AI configuration'), true)
    expect(a?.kind).toBe('unknown')
    expect(a?.message).toBe('Failed to load AI configuration')
    expect(a?.showRetry).toBe(true)
  })

  it('context overflow error shows Start fresh', () => {
    const a = chatErrorActions(new Error('Maximum context length exceeded'), true)
    expect(a?.kind).toBe('limit')
    expect(a?.showStartFresh).toBe(true)
  })

  it('rate limit error does not show Start fresh', () => {
    const a = chatErrorActions(new Error('429 rate limit'), true)
    expect(a?.showStartFresh).toBe(false)
  })
})

describe('readableError', () => {
  it('extracts the message from an Error', () => {
    expect(readableError(new Error('boom'))).toBe('boom')
  })

  it('passes strings through', () => {
    expect(readableError('plain')).toBe('plain')
  })

  it('stringifies objects', () => {
    expect(readableError({ a: 1 })).toBe('{"a":1}')
  })
})
