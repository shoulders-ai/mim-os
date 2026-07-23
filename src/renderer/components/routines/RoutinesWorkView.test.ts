// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
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
    document.body.innerHTML = ''
    root = document.createElement('div')
    document.body.appendChild(root)
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'routine.list') {
        return {
          routines: [
            {
              id: 'pulse',
              name: 'pulse',
              path: 'routines/pulse.md',
              description: 'Check project pulse.',
              trigger: { every: '4h' },
              tools: ['fs.read'],
              approvalAllow: [],
              body: 'Read the project and summarize drift.',
              authorityHash: 'authority',
              revision: 'revision',
              activation: 'active',
              nextRunAt: '2026-07-15T12:00:00.000Z',
              lastSuccessAt: '2026-07-14T12:00:00.000Z',
            },
          ],
          diagnostics: [],
        }
      }
      if (tool === 'ai.registry') {
        return {
          models: [{ id: 'claude-sonnet', provider: 'anthropic', displayName: 'Claude Sonnet', capabilities: { streaming: true, tools: true } }],
          defaults: { chat: ['claude-sonnet'] },
        }
      }
      if (tool === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
      if (tool === 'app.agents.list') return { agents: [] }
      if (tool === 'routine.disable') return { routine: { id: params?.name, activation: 'disabled' } }
      if (tool === 'routine.enable') return { routine: { id: params?.name, activation: 'active' } }
      if (tool === 'routine.start') return { sessionId: 'session_routine', routineRunId: 'rr1', status: 'working' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
  })

  it('renders automation rows and runs or disables them without resume terminology', async () => {
    const onOpenSession = vi.fn()
    const app = createApp(RoutinesWorkView, { active: true, onOpenSession })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Check project pulse.')
    expect(root.textContent).toContain('Every 4 hours')
    expect(root.textContent).toContain('Completed')
    expect(root.textContent).toContain('Next')
    expect(root.textContent).not.toContain('Resume')
    expect(root.textContent).not.toContain('Read the project and summarize drift.')

    root.querySelector<HTMLButtonElement>('[data-testid="routine-run"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="routine-automatic"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.start', { name: 'pulse' })
    expect(call).toHaveBeenCalledWith('routine.disable', { name: 'pulse' })
    expect(onOpenSession).toHaveBeenCalledWith('session_routine')
    app.unmount()
  })

  it('requires an authority review before enabling automatic runs', async () => {
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'routine.list') {
        return {
          routines: [{
            id: 'pulse', name: 'pulse', path: 'routines/pulse.md', description: 'Check project pulse.',
            trigger: { every: '4h' }, tools: ['fs.read'], approvalAllow: [], body: 'Check pulse.',
            authorityHash: 'authority', revision: 'revision', activation: 'review-required',
          }],
          diagnostics: [],
        }
      }
      if (tool === 'routine.enable') return { routine: { id: params?.name, activation: 'active' } }
      return tool === 'app.agents.list' ? { agents: [] } : tool === 'ai.keyStatus' ? { statuses: [] } : { models: [] }
    })
    const app = createApp(RoutinesWorkView, { active: true })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="routine-automatic"]')?.click()
    await flushUi()
    expect(document.body.textContent).toContain('Review automatic runs')
    document.body.querySelector<HTMLButtonElement>('[data-testid="routine-authority-enable"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.enable', { name: 'pulse' })
    app.unmount()
  })

  it('opens one structured creation dialog from the empty state', async () => {
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'routine.list') return { routines: [], diagnostics: [] }
      if (tool === 'ai.registry') {
        return {
          models: [{ id: 'claude-sonnet', provider: 'anthropic', displayName: 'Claude Sonnet', capabilities: { streaming: true, tools: true } }],
          defaults: { chat: ['claude-sonnet'] },
        }
      }
      if (tool === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
      if (tool === 'app.agents.list') return { agents: [] }
      if (tool === 'routine.create') {
        return {
          routine: {
            id: params?.name, name: params?.name, path: `routines/${params?.name}.md`,
            tools: [], approvalAllow: [], body: params?.body, authorityHash: 'authority', revision: 'revision', activation: 'review-required',
          },
        }
      }
      return {}
    })
    const app = createApp(RoutinesWorkView, { active: true })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Create your first routine')
    root.querySelector<HTMLButtonElement>('[data-testid="routine-empty-create"]')?.click()
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="routine-editor-trigger-daily"]')?.click()
    const name = document.body.querySelector<HTMLInputElement>('[data-testid="routine-editor-name"]')!
    name.value = 'daily-review'
    name.dispatchEvent(new Event('input'))
    const body = document.body.querySelector<HTMLTextAreaElement>('[data-testid="routine-editor-body"]')!
    body.value = 'Review the project.'
    body.dispatchEvent(new Event('input'))
    document.body.querySelector<HTMLButtonElement>('[data-testid="routine-editor-save"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.create', {
      name: 'daily-review',
      origin: 'project',
      trigger: { schedule: '0 9 * * *' },
      model: 'claude-sonnet',
      body: 'Review the project.',
    })
    app.unmount()
  })
})
