import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'

// Mock electron's BrowserWindow before importing bridge tools
const mockSend = vi.fn()
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      webContents: { send: mockSend }
    }]
  }
}))

// Import after mock is set up
const { registerBridgeTools } = await import('@main/tools/bridge.js')

describe('Bridge tools', () => {
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    mockSend.mockClear()
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    registerBridgeTools(tools)
  })

  it('chat.send emits bridge:chat:send', async () => {
    const result = await tools.call('chat.send', { message: 'hello' }, ctx) as { sent: boolean }
    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledWith('bridge:chat:send', {
      message: 'hello',
      sessionId: undefined
    })
  })

  it('chat.send includes optional sessionId', async () => {
    await tools.call('chat.send', { message: 'hi', sessionId: 'abc' }, ctx)
    expect(mockSend).toHaveBeenCalledWith('bridge:chat:send', {
      message: 'hi',
      sessionId: 'abc'
    })
  })

  it('chat.send rejects missing message', async () => {
    await expect(
      tools.call('chat.send', {}, ctx)
    ).rejects.toThrow('Missing required parameter: message')
  })

  it('editor.open emits bridge:editor:open', async () => {
    const result = await tools.call('editor.open', { path: 'docs/readme.md' }, ctx) as { opened: string }
    expect(result.opened).toBe('docs/readme.md')
    expect(mockSend).toHaveBeenCalledWith('bridge:editor:open', { path: 'docs/readme.md' })
  })

  it('editor.open rejects missing path', async () => {
    await expect(
      tools.call('editor.open', {}, ctx)
    ).rejects.toThrow('Missing required parameter: path')
  })

  it('terminal.run emits bridge:terminal:run', async () => {
    const result = await tools.call('terminal.run', { command: 'ls -la' }, ctx) as { sent: boolean }
    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledWith('bridge:terminal:run', { command: 'ls -la', reveal: true })
  })

  it('terminal.run from AI keeps the current Work surface visible', async () => {
    const result = await tools.call('terminal.run', { command: 'npm test' }, { actor: 'ai', sessionId: 's1' }) as { sent: boolean }
    expect(result.sent).toBe(true)
    expect(mockSend).toHaveBeenCalledWith('bridge:terminal:run', { command: 'npm test', reveal: false })
  })

  it('terminal.run rejects missing command', async () => {
    await expect(
      tools.call('terminal.run', {}, ctx)
    ).rejects.toThrow('Missing required parameter: command')
  })

  it('workbench.openWork opens the calling app Work view', async () => {
    const result = await tools.call(
      'workbench.openWork',
      { viewId: 'launch' },
      { actor: 'package', package_id: 'reviewer' }
    ) as { opened: boolean; pane: string; kind: string; packageId: string; viewId?: string }

    expect(result).toEqual({
      opened: true,
      pane: 'work',
      kind: 'package-view',
      packageId: 'reviewer',
      viewId: 'launch',
    })
    expect(mockSend).toHaveBeenCalledWith('bridge:workbench:open-work', {
      kind: 'package-view',
      packageId: 'reviewer',
      viewId: 'launch',
    })
  })

  it('workbench.openWork opens a concrete app run for the calling app', async () => {
    const result = await tools.call(
      'workbench.openWork',
      { kind: 'package-run', runId: 'run-1' },
      { actor: 'package', package_id: 'reviewer' }
    ) as { opened: boolean; pane: string; kind: string; packageId: string; runId: string }

    expect(result).toEqual({
      opened: true,
      pane: 'work',
      kind: 'package-run',
      packageId: 'reviewer',
      runId: 'run-1',
    })
    expect(mockSend).toHaveBeenCalledWith('bridge:workbench:open-work', {
      kind: 'package-run',
      packageId: 'reviewer',
      runId: 'run-1',
    })
  })

  it('workbench.openArtifact opens the calling app Artifact view', async () => {
    const result = await tools.call(
      'workbench.openArtifact',
      { viewId: 'report' },
      { actor: 'package', package_id: 'reviewer' }
    ) as { opened: boolean; pane: string; packageId: string; viewId?: string }

    expect(result).toEqual({
      opened: true,
      pane: 'artifact',
      packageId: 'reviewer',
      viewId: 'report',
    })
    expect(mockSend).toHaveBeenCalledWith('bridge:workbench:open-artifact', {
      kind: 'package-view',
      packageId: 'reviewer',
      viewId: 'report',
    })
  })

  it('workbench tools prevent apps from targeting other apps', async () => {
    await expect(
      tools.call(
        'workbench.openArtifact',
        { packageId: 'other', viewId: 'report' },
        { actor: 'package', package_id: 'reviewer' }
      )
    ).rejects.toThrow('App cannot open another app view')
  })

  it('workbench tools require packageId for non-app callers', async () => {
    await expect(
      tools.call('workbench.openWork', { viewId: 'launch' }, ctx)
    ).rejects.toThrow('Missing required parameter: packageId')
  })

  it('workbench.openWork requires a runId for app-run targets', async () => {
    await expect(
      tools.call(
        'workbench.openWork',
        { kind: 'package-run' },
        { actor: 'package', package_id: 'reviewer' }
      )
    ).rejects.toThrow('Missing required parameter: runId')
  })

  it('workbench.openWork rejects unknown Work targets', async () => {
    await expect(
      tools.call(
        'workbench.openWork',
        { kind: 'artifact-output', packageId: 'reviewer' },
        ctx
      )
    ).rejects.toThrow('Unsupported Work target: artifact-output')
  })

  it('all bridge tools are registered', () => {
    expect(tools.get('chat.send')).toBeDefined()
    expect(tools.get('editor.open')).toBeDefined()
    expect(tools.get('terminal.run')).toBeDefined()
    expect(tools.get('workbench.openWork')).toBeDefined()
    expect(tools.get('workbench.openArtifact')).toBeDefined()
  })
})
