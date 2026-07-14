import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { writeSharedWorkspaceToken } from './sharedWorkspaceTokens.js'
import { openSharedWorkspaceToolMount } from './sharedWorkspaceMount.js'
import { writeSharedWorkspaceFolderLink } from './sharedWorkspaceLinks.js'

let dirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function writeSharedConfig(workspace: string): void {
  writeFileSync(join(workspace, 'mim.yaml'), [
    'name: shared-mount-test',
    'sharedWorkspace:',
    '  id: team-server',
    '  url: https://mim.example.com/mcp',
    '  namespaces:',
    '    - issues.*',
    '',
  ].join('\n'))
}

describe('sharedWorkspaceMount', () => {
  it('mounts only after an explicit folder link exists', async () => {
    const workspace = makeDir('mim-shared-mount-ws-')
    const home = makeDir('mim-shared-mount-home-')
    writeSharedWorkspaceToken('team-server', 'tok_remote', { home })
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: body.method === 'initialize'
          ? {
              protocolVersion: '2025-06-18',
              serverInfo: { name: 'mim', version: '0.1.0' },
              capabilities: { tools: { listChanged: true } },
            }
          : { tools: [] },
      }))
    })
    vi.stubGlobal('fetch', fetch)

    await expect(openSharedWorkspaceToolMount({
      workspacePath: workspace,
      tools: createToolRegistry(createTraceLog()),
      home,
      watchCatalog: false,
    })).resolves.toBeNull()

    writeSharedWorkspaceFolderLink(workspace, {
      id: 'team-server',
      name: 'HTA Model',
      url: 'https://mim.example.com/mcp',
      namespaces: ['issues.*'],
    }, { now: () => new Date('2026-07-09T10:00:00.000Z') })

    const mount = await openSharedWorkspaceToolMount({
      workspacePath: workspace,
      tools: createToolRegistry(createTraceLog()),
      home,
      watchCatalog: false,
    })

    expect(mount).not.toBeNull()
    expect(fetch).toHaveBeenCalled()
  })

  it('returns null and warns when a workspace token is missing', async () => {
    const workspace = makeDir('mim-shared-mount-ws-')
    const home = makeDir('mim-shared-mount-home-')
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeSharedConfig(workspace)
    const warn = vi.fn()

    await expect(openSharedWorkspaceToolMount({
      workspacePath: workspace,
      tools: createToolRegistry(createTraceLog()),
      home,
      onWarning: warn,
    })).resolves.toBeNull()

    expect(warn).toHaveBeenCalledWith('Shared workspace "team-server" is configured but no local token is stored')
  })

  it('warns when the server handshake looks incompatible', async () => {
    const workspace = makeDir('mim-shared-mount-ws-')
    const home = makeDir('mim-shared-mount-home-')
    writeSharedConfig(workspace)
    writeSharedWorkspaceToken('team-server', 'tok_remote', { home })
    const warn = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'mim', version: '9.0.0' },
            capabilities: {},
          },
        }))
      }
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: [] },
      }))
    }))

    const mount = await openSharedWorkspaceToolMount({
      workspacePath: workspace,
      tools: createToolRegistry(createTraceLog()),
      home,
      watchCatalog: false,
      appVersion: '0.1.2',
      onWarning: warn,
    })

    expect(mount).not.toBeNull()
    expect(warn.mock.calls.map(call => call[0])).toEqual([
      'Shared workspace "team-server" server version 9.0.0 differs from local version 0.1.2; remote tool schemas may be incompatible',
      'Shared workspace "team-server" did not advertise MCP tools capability',
    ])
  })
})
