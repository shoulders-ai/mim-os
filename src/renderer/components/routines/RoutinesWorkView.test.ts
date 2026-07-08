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
      if (tool === 'ai.registry') {
        return {
          models: [
            {
              id: 'claude-sonnet',
              provider: 'anthropic',
              displayName: 'Claude Sonnet',
              shortLabel: 'Sonnet',
              capabilities: { streaming: true, tools: true },
            },
          ],
          defaults: { chat: ['claude-sonnet'] },
        }
      }
      if (tool === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
      if (tool === 'routine.pause') return { routine: { id: params?.name, enabled: false, paused: true } }
      if (tool === 'routine.start') return { sessionId: 'session_routine', routineRunId: 'rr1', status: 'working' }
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
    expect(root.textContent).toContain('Every 4 hours')
    expect(root.textContent).toContain('fs.read')
    expect(root.textContent).toContain('Read the project and summarize drift.')

    root.querySelector<HTMLButtonElement>('[data-testid="routine-run-now"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="routine-pause"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.start', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.pause', { name: 'pulse' })
    expect(onOpenSession).toHaveBeenCalledWith('session_routine')
    app.unmount()
  })

  it('shows a create affordance when no routines exist and opens the new file', async () => {
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'routine.list') return { routines: [], diagnostics: [] }
      if (tool === 'ai.registry') {
        return {
          models: [
            {
              id: 'claude-sonnet',
              provider: 'anthropic',
              displayName: 'Claude Sonnet',
              shortLabel: 'Sonnet',
              capabilities: { streaming: true, tools: true },
            },
          ],
          defaults: { chat: ['claude-sonnet'] },
        }
      }
      if (tool === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
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
      return {}
    })
    const onOpenFile = vi.fn()
    const app = createApp(RoutinesWorkView, { active: true, onOpenFile })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    expect(root.querySelector('[data-testid="routine-create-form"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="model-picker-trigger"]')).toBeTruthy()
    expect(root.textContent).not.toContain('Cron')
    root.querySelector<HTMLButtonElement>('[data-testid="routine-mode-daily"]')?.click()
    const name = root.querySelector<HTMLInputElement>('[data-testid="routine-create-name"]')!
    name.value = 'daily-review'
    name.dispatchEvent(new Event('input'))
    const body = root.querySelector<HTMLTextAreaElement>('[data-testid="routine-create-body"]')!
    body.value = 'Review the project.'
    body.dispatchEvent(new Event('input'))

    root.querySelector<HTMLButtonElement>('[data-testid="routine-create-submit"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.create', {
      name: 'daily-review',
      model: 'claude-sonnet',
      trigger: { schedule: '0 9 * * *' },
      body: 'Review the project.',
    })
    expect(onOpenFile).toHaveBeenCalledWith('routines/daily-review.md')
    app.unmount()
  })
})
