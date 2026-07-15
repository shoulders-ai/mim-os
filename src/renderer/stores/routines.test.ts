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
          routines: [{ id: 'pulse', name: 'pulse', revision: 'rev-1', activation: 'review-required', trigger: { every: '4h' } }],
          diagnostics: [],
        }
      }
      if (tool === 'routine.create') {
        return {
          routine: {
            id: params?.name,
            name: params?.name,
            path: `routines/${params?.name}.md`,
            revision: 'rev-created',
            activation: 'manual',
            body: params?.body,
          },
        }
      }
      if (tool === 'routine.start') return { sessionId: 'session_routine', routineRunId: 'rr1', status: 'working' }
      if (tool === 'routine.enable') return { routine: { id: params?.name, activation: 'active' } }
      if (tool === 'routine.disable') return { routine: { id: params?.name, activation: 'disabled' } }
      if (tool === 'routine.update') return { routine: { id: params?.name, revision: 'rev-2', body: params?.body } }
      if (tool === 'routine.duplicate') {
        return { routine: { id: params?.newName, name: params?.newName, revision: 'rev-copy', activation: 'review-required' } }
      }
      if (tool === 'routine.remove') return { removed: params?.name, path: `routines/${params?.name}.md` }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call },
    })
  })

  it('loads routines and exposes the complete routine management contract', async () => {
    const store = useRoutineStore()

    await store.load()
    expect(store.routines).toEqual([
      expect.objectContaining({ id: 'pulse', activation: 'review-required' }),
    ])
    expect(store.loaded).toBe(true)

    const created = await store.create({
      name: 'daily-review',
      model: 'claude-sonnet',
      body: 'Review the project.',
    })
    const updated = await store.update({
      name: 'pulse',
      expectedRevision: 'rev-1',
      trigger: { every: '4h' },
      body: 'Review the project pulse.',
    })
    const duplicate = await store.duplicate('pulse', 'pulse-copy')
    await store.enable('pulse')
    await store.disable('pulse')
    const run = await store.runNow('pulse')
    await store.remove('pulse')

    expect(call).toHaveBeenCalledWith('routine.create', { name: 'daily-review', model: 'claude-sonnet', body: 'Review the project.' })
    expect(created).toMatchObject({ id: 'daily-review', path: 'routines/daily-review.md' })
    expect(store.routines.some(routine => routine.id === 'daily-review')).toBe(true)
    expect(call).toHaveBeenCalledWith('routine.update', {
      name: 'pulse',
      expectedRevision: 'rev-1',
      trigger: { every: '4h' },
      body: 'Review the project pulse.',
    })
    expect(call).toHaveBeenCalledWith('routine.duplicate', { name: 'pulse', newName: 'pulse-copy' })
    expect(call).toHaveBeenCalledWith('routine.enable', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.disable', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.start', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.remove', { name: 'pulse' })
    expect(updated).toMatchObject({ id: 'pulse', revision: 'rev-2' })
    expect(duplicate).toMatchObject({ id: 'pulse-copy' })
    expect(run).toMatchObject({ sessionId: 'session_routine' })
    expect(store.isRunning('pulse')).toBe(false)
    expect(store.routines.some(routine => routine.id === 'pulse')).toBe(false)
  })
})
