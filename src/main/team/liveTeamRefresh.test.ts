import { describe, expect, it, vi } from 'vitest'
import { refreshLiveTeamContributions } from './liveTeamRefresh.js'

describe('live Team contribution refresh', () => {
  it('refreshes every Team-backed capability in dependency order', async () => {
    const calls: string[] = []

    await refreshLiveTeamContributions({
      syncMount: vi.fn(async () => { calls.push('mount') }),
      rescanApps: vi.fn(async () => { calls.push('apps') }),
      syncNamedTools: vi.fn(async () => { calls.push('tools') }),
      refreshRoutines: vi.fn(async () => { calls.push('routines') }),
      refreshSlack: vi.fn(async () => { calls.push('slack') }),
      notifyRoutines: vi.fn(() => { calls.push('notify') }),
    })

    expect(calls).toEqual(['mount', 'apps', 'tools', 'routines', 'slack', 'notify'])
  })

  it('still refreshes mounted files and routines before an app runtime exists', async () => {
    const syncMount = vi.fn(async () => undefined)
    const refreshRoutines = vi.fn(async () => undefined)

    await refreshLiveTeamContributions({
      syncMount,
      refreshRoutines,
    })

    expect(syncMount).toHaveBeenCalledOnce()
    expect(refreshRoutines).toHaveBeenCalledOnce()
  })
})
