import { describe, expect, it } from 'vitest'
import { buildSessionExport, sessionExportFilename } from './sessionExport.js'
import type { Session } from '../stores/sessions.js'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    label: 'Refactor auth',
    modelId: 'model-x',
    controlId: '',
    messages: [{ id: 'm1', role: 'user', content: 'hi' } as never],
    usage: { inputTokens: 1, outputTokens: 2, estimatedCost: 0.3 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('session export', () => {
  it('builds the v1 payload from the session fields', () => {
    const payload = buildSessionExport(makeSession())

    expect(payload._format).toBe('mim-session-v1')
    expect(payload.session).toEqual({
      id: 's1',
      label: 'Refactor auth',
      modelId: 'model-x',
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
      usage: { inputTokens: 1, outputTokens: 2, estimatedCost: 0.3 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
  })

  it('derives a safe filename from the label', () => {
    expect(sessionExportFilename(makeSession({ label: 'Refactor auth: v2/final' }))).toBe('Refactor_auth__v2_final.json')
    expect(sessionExportFilename(makeSession({ label: '' }))).toBe('session.json')
  })
})
