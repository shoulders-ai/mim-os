import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerTeamTools } from '@main/tools/team.js'

const ctx = { actor: 'user' as const }

describe('Team tools', () => {
  let tools: ReturnType<typeof createToolRegistry>
  let source: {
    status: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    sync: ReturnType<typeof vi.fn>
  }
  let emit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tools = createToolRegistry(createTraceLog())
    source = {
      status: vi.fn(async () => ({ state: 'disconnected' })),
      connect: vi.fn(async (repository: string) => ({ state: 'synced', repository })),
      open: vi.fn(async () => ({ name: 'Shoulders', root: '/home/.mim/team' })),
      sync: vi.fn(async () => ({ state: 'synced' })),
    }
    emit = vi.fn()
    registerTeamTools(tools, { source, emit })
  })

  it('registers the single-source status, connect, open, and sync surface', () => {
    expect(tools.list().map(tool => tool.name)).toEqual([
      'team.status',
      'team.connect',
      'team.open',
      'team.sync',
    ])
    for (const tool of tools.list()) expect(tool.inputSchema).toBeDefined()
  })

  it('routes every action through the same Team source resolver', async () => {
    await expect(tools.call('team.status', {}, ctx)).resolves.toEqual({ state: 'disconnected' })
    await expect(tools.call('team.connect', { repository: '/repos/team.git' }, ctx))
      .resolves.toEqual({ state: 'synced', repository: '/repos/team.git' })
    await expect(tools.call('team.open', {}, ctx))
      .resolves.toEqual({ team: { name: 'Shoulders', root: '/home/.mim/team' } })
    await expect(tools.call('team.sync', {}, ctx)).resolves.toEqual({ state: 'synced' })

    expect(source.connect).toHaveBeenCalledWith('/repos/team.git')
    expect(source.status).toHaveBeenCalledOnce()
    expect(source.open).toHaveBeenCalledOnce()
    expect(source.sync).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenNthCalledWith(1, 'team:changed')
    expect(emit).toHaveBeenNthCalledWith(2, 'team:changed')
  })

  it('rejects an empty repository before reaching the resolver', async () => {
    await expect(tools.call('team.connect', { repository: '   ' }, ctx))
      .rejects.toThrow('repository')
    expect(source.connect).not.toHaveBeenCalled()
  })
})
