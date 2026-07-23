import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from './registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerCoreAppTools } from './coreApps.js'

describe('direct-source app tools', () => {
  const pkg = {
    manifest: {
      manifestVersion: 1 as const,
      id: 'notes',
      name: 'Notes',
      version: '1.0.0',
      views: [],
      permissions: {},
    },
    dir: '/team/apps/notes',
    source: 'team' as const,
    hasReadme: true,
  }
  let tools: ReturnType<typeof createToolRegistry>
  let enabled: boolean

  beforeEach(() => {
    enabled = false
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath('/project')
    registerCoreAppTools(tools, {
      packages: {
        list: () => [pkg],
        get: id => id === 'notes' ? pkg : undefined,
        diagnostics: () => [],
        root: () => null,
        onChange: vi.fn(),
        rescan: vi.fn(),
      },
      enablement: {
        isEnabled: () => enabled,
        setEnabled: (_id, value) => { enabled = value },
        clearOverride: vi.fn(),
        localOverride: () => enabled ? true : null,
        isTrusted: () => true,
        ackTrust: vi.fn(),
        needsTrust: () => false,
        diagnostics: () => [],
      },
    })
  })

  it('reports the natural origin and local activation', async () => {
    expect(await tools.call('app.status', {}, { actor: 'user' })).toMatchObject({
      apps: [{ id: 'notes', source: 'team', enabled: false, needsInstall: false }],
    })
  })

  it('changes only local activation', async () => {
    await tools.call('app.enable', { id: 'notes' }, { actor: 'user' })
    expect(enabled).toBe(true)
    await tools.call('app.disable', { id: 'notes' }, { actor: 'user' })
    expect(enabled).toBe(false)
  })
})
