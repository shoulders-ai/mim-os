// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import RoutineEditorDialog from './RoutineEditorDialog.vue'
import type { RoutineDefinition } from '../../stores/routines.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const existing: RoutineDefinition = {
  id: 'pulse',
  path: 'routines/pulse.md',
  name: 'pulse',
  description: 'Check project pulse.',
  trigger: { every: '4h' },
  agent: 'package:research/reviewer',
  model: 'claude-sonnet',
  tools: ['fs.read', 'fs.write'],
  approvalAllow: ['fs.read'],
  steps: 40,
  missed: 'once',
  body: 'Read the project and summarize drift.',
  authorityHash: 'authority',
  revision: 'revision-1',
  activation: 'active',
}

describe('RoutineEditorDialog', () => {
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    document.body.innerHTML = ''
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'ai.registry') {
        return {
          models: [{ id: 'claude-sonnet', provider: 'anthropic', displayName: 'Claude Sonnet', capabilities: { streaming: true, tools: true } }],
          defaults: { chat: ['claude-sonnet'] },
        }
      }
      if (tool === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
      if (tool === 'app.agents.list') return { agents: [{ id: 'package:research/reviewer', name: 'Reviewer', packageId: 'research', key: 'reviewer', scoped: true, skills: [], diagnostics: [] }] }
      if (tool === 'routine.update') return { routine: { ...existing, ...params, revision: 'revision-2' } }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call },
    })
  })

  it('edits every routine field through one revision-aware structured form', async () => {
    const onSaved = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(RoutineEditorDialog, { open: true, routine: existing, onSaved })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    expect(document.body.textContent).toContain('Edit routine')
    expect(document.body.textContent).toContain('Automatic access')
    const prompt = document.body.querySelector<HTMLTextAreaElement>('[data-testid="routine-editor-body"]')!
    prompt.value = 'Read the project and write a concise pulse report.'
    prompt.dispatchEvent(new Event('input'))
    document.body.querySelector<HTMLButtonElement>('[data-testid="routine-editor-save"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.update', {
      name: 'pulse',
      expectedRevision: 'revision-1',
      description: 'Check project pulse.',
      trigger: { every: '4h' },
      agent: 'package:research/reviewer',
      model: 'claude-sonnet',
      tools: ['fs.read', 'fs.write'],
      approvalAllow: ['fs.read'],
      steps: 40,
      missed: 'once',
      body: 'Read the project and write a concise pulse report.',
    })
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 'revision-2' }))
    app.unmount()
  })

  it('preserves every Slack channel and an unpinned model during an unrelated edit', async () => {
    const slackRoutine: RoutineDefinition = {
      ...existing,
      model: undefined,
      trigger: {
        slack: {
          account: 'team',
          channels: [
            { id: 'C_GENERAL', mode: 'mention' },
            { id: 'C_ALERTS', mode: 'always' },
          ],
        },
      },
    }
    const root = document.createElement('div')
    document.body.appendChild(root)
    const app = createApp(RoutineEditorDialog, { open: true, routine: slackRoutine })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    document.body.querySelector<HTMLButtonElement>('[data-testid="routine-editor-save"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('routine.update', expect.objectContaining({
      name: 'pulse',
      trigger: slackRoutine.trigger,
    }))
    expect(call).toHaveBeenCalledWith('routine.update', expect.not.objectContaining({ model: expect.anything() }))
    app.unmount()
  })
})
