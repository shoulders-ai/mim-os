import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createServeInvite } from '@main/serve/invites.js'
import {
  inspectSharedWorkspaceInvite,
  joinSharedWorkspaceFromInvite,
} from './sharedWorkspaceInvite.js'
import { listSharedWorkspaceConnections } from './sharedWorkspaceConnections.js'
import { readSharedWorkspaceToken } from './sharedWorkspaceTokens.js'
import { parseMimYaml } from './workspaceContract.js'

describe('shared workspace invite join', () => {
  it('inspects an invite without network access and joins by storing a user connection plus local token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mim-shared-join-'))
    const home = join(root, 'home')
    const workspacePath = join(root, 'workspace')
    try {
      mkdirSync(workspacePath, { recursive: true })
      writeFileSync(join(workspacePath, 'mim.yaml'), [
        'name: local-notes',
        'apps:',
        '  board: true',
        '',
      ].join('\n'))

      const invite = createServeInvite({
        home: join(root, 'server-home'),
        workspacePath: join(root, 'server-workspace'),
        name: 'Anna',
        url: 'https://mim.example.com/mcp',
        workspaceId: 'team-server',
        workspaceName: 'HTA Model',
        namespaces: ['issues.*', 'knowledge.*'],
        secret: 'invite_secret',
      })

      expect(inspectSharedWorkspaceInvite(invite.deepLink)).toMatchObject({
        id: invite.record.id,
        callerName: 'Anna',
        workspaceId: 'team-server',
        workspaceName: 'HTA Model',
        host: 'mim.example.com',
        namespaces: ['issues.*', 'knowledge.*'],
      })

      const fetchUrl = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('https://mim.example.com/join')
        expect(JSON.parse(String(init?.body))).toEqual({ invite: invite.deepLink })
        return new Response(JSON.stringify({
          callerName: 'Anna',
          token: 'mim_serve_durable_token',
          sharedWorkspace: {
            id: 'team-server',
            name: 'HTA Model',
            url: 'https://mim.example.com/mcp',
            namespaces: ['issues.*', 'knowledge.*'],
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const joined = await joinSharedWorkspaceFromInvite({
        workspacePath,
        home,
        invite: invite.deepLink,
        fetchUrl,
      })

      expect(joined).toEqual({
        joined: true,
        callerName: 'Anna',
        sharedWorkspace: {
          id: 'team-server',
          name: 'HTA Model',
          url: 'https://mim.example.com/mcp',
          namespaces: ['issues.*', 'knowledge.*'],
        },
        tokenStored: true,
      })
      expect(JSON.stringify(joined)).not.toContain('mim_serve_durable_token')
      expect(readSharedWorkspaceToken('team-server', { home })).toBe('mim_serve_durable_token')
      expect(listSharedWorkspaceConnections({ home })).toEqual([{
        id: 'team-server',
        name: 'HTA Model',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*', 'knowledge.*'],
        callerName: 'Anna',
        connectedAt: expect.any(String),
      }])

      const config = parseMimYaml(readFileSync(join(workspacePath, 'mim.yaml'), 'utf-8'))
      expect(config.name).toBe('local-notes')
      expect(config.apps).toEqual({ board: true })
      expect(config.sharedWorkspace).toBeUndefined()
      expect(existsSync(join(workspacePath, '.mim', 'shared-workspace.json'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
