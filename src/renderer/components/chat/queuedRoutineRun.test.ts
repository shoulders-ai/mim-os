import { describe, expect, it } from 'vitest'
import { queuedRoutineSeedMessage } from './queuedRoutineRun.js'

describe('queuedRoutineSeedMessage', () => {
  const session = {
    id: 'session_1',
    routineId: 'daily-summary',
    routineRunId: 'routine_run_1',
    routineStatus: 'working',
  }
  const message = {
    id: 'routine_prompt_daily-summary_routine_run_1',
    role: 'user',
    parts: [{ type: 'text', text: 'Summarize the workspace.' }],
    metadata: {
      routine: {
        id: 'daily-summary',
        runId: 'routine_run_1',
        trigger: 'manual',
        queued: true,
      },
    },
  }

  it('returns the single queued user message for the active routine run', () => {
    expect(queuedRoutineSeedMessage(session, [message])).toBe(message)
  })

  it('rejects sessions that are not queued active routine runs', () => {
    expect(queuedRoutineSeedMessage(null, [message])).toBeNull()
    expect(queuedRoutineSeedMessage({ ...session, routineStatus: 'done' }, [message])).toBeNull()
    expect(queuedRoutineSeedMessage({ ...session, routineId: '' }, [message])).toBeNull()
    expect(queuedRoutineSeedMessage({ ...session, routineRunId: '' }, [message])).toBeNull()
  })

  it('rejects ambiguous or mismatched message history', () => {
    expect(queuedRoutineSeedMessage(session, [])).toBeNull()
    expect(queuedRoutineSeedMessage(session, [message, { ...message, id: 'm2' }])).toBeNull()
    expect(queuedRoutineSeedMessage(session, [{ ...message, role: 'assistant' }])).toBeNull()
    expect(queuedRoutineSeedMessage(session, [{ ...message, metadata: {} }])).toBeNull()
    expect(queuedRoutineSeedMessage(session, [{
      ...message,
      metadata: { routine: { id: 'other', runId: 'routine_run_1', queued: true } },
    }])).toBeNull()
    expect(queuedRoutineSeedMessage(session, [{
      ...message,
      metadata: { routine: { id: 'daily-summary', runId: 'other', queued: true } },
    }])).toBeNull()
  })
})
