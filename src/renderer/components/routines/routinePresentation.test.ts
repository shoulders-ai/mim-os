import { describe, expect, it } from 'vitest'
import {
  routineAccessSummary,
  routineActivationLabel,
  routineHealth,
  routineTriggerLabel,
  sortRoutinesForAttention,
} from './routinePresentation.js'
import type { RoutineDefinition } from '../../stores/routines.js'

function routine(overrides: Partial<RoutineDefinition> = {}): RoutineDefinition {
  return {
    id: 'pulse',
    path: 'routines/pulse.md',
    origin: 'project',
    name: 'pulse',
    tools: [],
    approvalAllow: [],
    body: 'Check the project pulse.',
    authorityHash: 'authority',
    revision: 'revision',
    activation: 'manual',
    ...overrides,
  }
}

describe('routine presentation', () => {
  it('describes triggers and access without exposing implementation syntax', () => {
    expect(routineTriggerLabel(routine({ trigger: { every: '4h' } }))).toBe('Every 4 hours')
    expect(routineTriggerLabel(routine({ trigger: { schedule: '0 9 * * 1' } }))).toBe('Mon at 09:00')
    expect(routineTriggerLabel(routine({ trigger: { files: { path: 'inbox/' } } }))).toBe('When inbox/ changes')
    expect(routineAccessSummary(routine())).toBe('Default access')
    expect(routineAccessSummary(routine({ tools: ['fs.read', 'fs.write'], approvalAllow: ['fs.read'] }))).toBe('2 tools · 1 allowed without asking')
  })

  it('keeps activation and run health as separate concepts', () => {
    expect(routineActivationLabel(routine({ activation: 'review-required' }))).toBe('Review required')
    expect(routineHealth(routine({ lastSuccessAt: '2026-07-13T09:00:00.000Z' }))).toBe('succeeded')
    expect(routineHealth(routine({
      lastSuccessAt: '2026-07-13T09:00:00.000Z',
      lastErrorAt: '2026-07-14T09:00:00.000Z',
    }))).toBe('failed')
  })

  it('sorts attention first, then upcoming automatic work, then manual and disabled routines', () => {
    const sorted = sortRoutinesForAttention([
      routine({ id: 'manual', name: 'manual' }),
      routine({ id: 'disabled', name: 'disabled', activation: 'disabled', trigger: { every: '4h' } }),
      routine({ id: 'later', name: 'later', activation: 'active', trigger: { every: '4h' }, nextRunAt: '2026-07-15T09:00:00.000Z' }),
      routine({ id: 'review', name: 'review', activation: 'review-required', trigger: { every: '4h' } }),
      routine({ id: 'failed', name: 'failed', activation: 'active', trigger: { every: '4h' }, lastErrorAt: '2026-07-14T09:00:00.000Z' }),
      routine({ id: 'sooner', name: 'sooner', activation: 'active', trigger: { every: '4h' }, nextRunAt: '2026-07-14T09:00:00.000Z' }),
    ])

    expect(sorted.map(item => item.id)).toEqual(['failed', 'review', 'sooner', 'later', 'manual', 'disabled'])
  })
})
