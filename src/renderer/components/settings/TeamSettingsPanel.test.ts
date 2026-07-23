// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import TeamSettingsPanel from './TeamSettingsPanel.vue'

describe('TeamSettingsPanel', () => {
  it('shows the actual Team identity, contributions, and natural source actions', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'team.status') {
        return {
          state: 'synced',
          repository: 'git@github.com:shoulders-ai/team.git',
          message: 'Synced.',
          team: {
            name: 'Shoulders',
            root: '/tmp/team',
            contributions: { files: 3, skills: 2, apps: 1, routines: 4, instructions: true },
          },
        }
      }
      if (tool === 'team.open') return { team: { root: '/tmp/team' } }
      return {}
    })
    const revealInFinder = vi.fn()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, revealInFinder, on: vi.fn(), off: vi.fn() },
    })
    const root = document.createElement('div')
    const app = createApp(TeamSettingsPanel)
    app.mount(root)
    await Promise.resolve()
    await nextTick()

    expect(root.textContent).toContain('Shoulders')
    expect(root.textContent).toContain('Files · Skills · Apps · Routines')
    expect(root.textContent).toContain('automatically')
    root.querySelector<HTMLButtonElement>('[data-testid="team-open"]')?.click()
    await Promise.resolve()
    expect(revealInFinder).toHaveBeenCalledWith('/tmp/team')
    app.unmount()
  })

  it('shows the system Git setup action before Team connection', async () => {
    const call = vi.fn(async () => ({
      state: 'disconnected',
      repository: null,
      message: 'Connect a Team source.',
      team: null,
      git: {
        available: false,
        installAction: 'Run winget install --id Git.Git -e, then try again.',
        lfsRequired: false,
        lfsAvailable: null,
        lfsInstallAction: null,
      },
    }))
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, revealInFinder: vi.fn(), on: vi.fn(), off: vi.fn() },
    })
    const root = document.createElement('div')
    const app = createApp(TeamSettingsPanel)
    app.mount(root)
    await Promise.resolve()
    await nextTick()

    expect(root.textContent).toContain('Run winget install')
    app.unmount()
  })
})
