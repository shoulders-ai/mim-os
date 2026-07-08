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
      if (tool === 'routine.create') {
        return {
          routine: {
            id: params?.name,
            name: params?.name,
            path: `routines/${params?.name}.md`,
            enabled: false,
            paused: false,
            needsEnablement: true,
            body: params?.body,
          },
        }
      }
      if (tool === 'routine.start') return { sessionId: 'session_routine', routineRunId: 'rr1', status: 'working' }
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
    expect(store.loaded).toBe(true)

    const created = await store.create({
      name: 'daily-review',
      model: 'claude-sonnet',
      body: 'Review the project.',
    })
    await store.resume('pulse')
    await store.pause('pulse')
    const run = await store.runNow('pulse')

    expect(call).toHaveBeenCalledWith('routine.create', { name: 'daily-review', model: 'claude-sonnet', body: 'Review the project.' })
    expect(created).toMatchObject({ id: 'daily-review', path: 'routines/daily-review.md' })
    expect(store.routines.some(routine => routine.id === 'daily-review')).toBe(true)
    expect(call).toHaveBeenCalledWith('routine.resume', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.pause', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.start', { name: 'pulse' })
    expect(run).toMatchObject({ sessionId: 'session_routine' })
    expect(store.isRunning('pulse')).toBe(false)
  })
})
