// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRoutineStore } from './routines.js'

describe('routine store', () => {
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'routine.list') {
        return {
          routines: [{ id: 'pulse', name: 'pulse', enabled: false, paused: false, needsEnablement: true }],
          diagnostics: [],
        }
      }
      if (tool === 'routine.run') return { sessionId: 'session_routine', routineRunId: 'rr1', status: 'done' }
      if (tool === 'routine.resume') return { routine: { id: params?.name, enabled: true, paused: false, needsEnablement: false } }
      if (tool === 'routine.pause') return { routine: { id: params?.name, enabled: false, paused: true, needsEnablement: false } }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call },
    })
  })

  it('loads routines and exposes run/pause/resume commands', async () => {
    const store = useRoutineStore()

    await store.load()
    expect(store.routines).toEqual([
      expect.objectContaining({ id: 'pulse', needsEnablement: true }),
    ])

    await store.resume('pulse')
    await store.pause('pulse')
    const run = await store.runNow('pulse')

    expect(call).toHaveBeenCalledWith('routine.resume', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.pause', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.run', { name: 'pulse' })
    expect(run).toMatchObject({ sessionId: 'session_routine' })
    expect(store.isRunning('pulse')).toBe(false)
  })
})
