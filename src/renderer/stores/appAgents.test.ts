import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppAgentsStore, type AppAgent } from './appAgents.js'

function makeAgent(overrides: Partial<AppAgent> = {}): AppAgent {
  return {
    id: 'package:test-pkg/default',
    packageId: 'test-pkg',
    key: 'default',
    name: 'Test Agent',
    scoped: false,
    skills: [],
    diagnostics: [],
    ...overrides,
  }
}

function stubKernel(agents: AppAgent[] = []) {
  const call = vi.fn(async (tool: string) => {
    if (tool === 'app.agents.list') return { agents }
    throw new Error(`Unexpected tool: ${tool}`)
  })
  vi.stubGlobal('window', { kernel: { call, on: vi.fn(), off: vi.fn() } })
  return call
}

describe('appAgents store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('starts empty before any fetch', () => {
    stubKernel()
    const store = useAppAgentsStore()
    expect(store.agents).toEqual([])
    expect(store.byId('package:test-pkg/default')).toBeUndefined()
  })

  it('refreshes from app.agents.list and populates the agents array', async () => {
    const agents = [
      makeAgent({ id: 'package:research/default', packageId: 'research', key: 'default', name: 'Research' }),
      makeAgent({ id: 'package:coder/review', packageId: 'coder', key: 'review', name: 'Code Review', model: 'claude-sonnet' }),
    ]
    const call = stubKernel(agents)
    const store = useAppAgentsStore()
    await store.refresh()

    expect(call).toHaveBeenCalledWith('app.agents.list')
    expect(store.agents).toHaveLength(2)
    expect(store.agents[0].name).toBe('Research')
    expect(store.agents[1].model).toBe('claude-sonnet')
  })

  it('byId returns the agent with the matching id', async () => {
    const agents = [
      makeAgent({ id: 'package:research/default', name: 'Research' }),
      makeAgent({ id: 'package:coder/review', name: 'Code Review' }),
    ]
    stubKernel(agents)
    const store = useAppAgentsStore()
    await store.refresh()

    expect(store.byId('package:research/default')?.name).toBe('Research')
    expect(store.byId('package:coder/review')?.name).toBe('Code Review')
    expect(store.byId('package:nonexistent/x')).toBeUndefined()
  })

  it('survives kernel failure on refresh gracefully', async () => {
    const call = vi.fn(async () => { throw new Error('no workspace') })
    vi.stubGlobal('window', { kernel: { call, on: vi.fn(), off: vi.fn() } })

    const store = useAppAgentsStore()
    await store.refresh()

    expect(store.agents).toEqual([])
  })

  it('refresh clears stale agents and rebuilds from authoritative response', async () => {
    const first = [makeAgent({ id: 'package:a/default', name: 'Agent A' })]
    const second = [makeAgent({ id: 'package:b/default', name: 'Agent B' })]

    const call = stubKernel(first)
    const store = useAppAgentsStore()
    await store.refresh()
    expect(store.agents).toHaveLength(1)
    expect(store.agents[0].name).toBe('Agent A')

    call.mockResolvedValue({ agents: second })
    await store.refresh()
    expect(store.agents).toHaveLength(1)
    expect(store.agents[0].name).toBe('Agent B')
    expect(store.byId('package:a/default')).toBeUndefined()
  })
})
