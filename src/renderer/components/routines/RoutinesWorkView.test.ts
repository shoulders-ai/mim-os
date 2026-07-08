// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import RoutinesWorkView from './RoutinesWorkView.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('RoutinesWorkView', () => {
  let root: HTMLElement
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'routine.list') {
        return {
          routines: [
            {
              id: 'pulse',
              name: 'pulse',
              description: 'Check project pulse.',
              trigger: { every: '4h' },
              tools: ['fs.read'],
              approvalAllow: [],
              body: 'Read the project and summarize drift.',
              enabled: true,
              paused: false,
              needsEnablement: false,
              nextRunAt: '2026-07-08T12:00:00.000Z',
            },
          ],
          diagnostics: [],
        }
      }
      if (tool === 'routine.pause') return { routine: { id: params?.name, enabled: false, paused: true } }
      if (tool === 'routine.run') return { sessionId: 'session_routine', routineRunId: 'rr1', status: 'done' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call },
    })
  })

  it('renders routine authority and runs/pause controls', async () => {
    const onOpenSession = vi.fn()
    const app = createApp(RoutinesWorkView, { active: true, onOpenSession })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('pulse')
    expect(root.textContent).toContain('Every 4h')
    expect(root.textContent).toContain('fs.read')
    expect(root.textContent).toContain('Read the project and summarize drift.')

    root.querySelector<HTMLButtonElement>('[data-testid="routine-run-now"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="routine-pause"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.run', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.pause', { name: 'pulse' })
    expect(onOpenSession).toHaveBeenCalledWith('session_routine')
    app.unmount()
  })
})
