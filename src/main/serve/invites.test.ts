import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createServeInvite,
  inspectServeInvite,
  listServeInvites,
  redeemServeInvite,
  revokeServeInvite,
} from '@main/serve/invites.js'
import { validateServeToken } from '@main/serve/tokens.js'

describe('serve invites', () => {
  it('creates a single-use invite, stores only the secret hash, and redeems to a caller token', () => {
    const home = mkdtempSync(join(tmpdir(), 'mim-serve-invite-'))
    const workspacePath = join(home, 'workspace')
    try {
      const invite = createServeInvite({
        home,
        workspacePath,
        name: 'Anna',
        url: 'https://mim.example.com/mcp',
        workspaceId: 'team-server',
        workspaceName: 'HTA Model',
        namespaces: ['knowledge.*', 'issues.*'],
        secret: 'invite_secret_for_test',
        token: 'mim_serve_redeemed_token',
        now: () => new Date('2026-07-08T10:00:00.000Z'),
      })

      expect(invite.invite).toMatch(/^mim-invite-/)
      expect(invite.deepLink).toMatch(/^mim:\/\/join\//)
      expect(invite.record).toMatchObject({
        name: 'Anna',
        url: 'https://mim.example.com/mcp',
        workspaceId: 'team-server',
        workspaceName: 'HTA Model',
        namespaces: ['issues.*', 'knowledge.*'],
      })
      expect(inspectServeInvite(invite.invite)).toMatchObject({
        id: invite.record.id,
        callerName: 'Anna',
        workspaceId: 'team-server',
        workspaceName: 'HTA Model',
      })

      const raw = readFileSync(invite.storePath, 'utf-8')
      expect(raw).not.toContain('invite_secret_for_test')
      expect(raw).toContain(invite.record.hash)

      const redeemed = redeemServeInvite({
        home,
        workspacePath,
        invite: invite.invite,
        now: () => new Date('2026-07-08T10:01:00.000Z'),
      })
      expect(redeemed).toMatchObject({
        token: 'mim_serve_redeemed_token',
        sharedWorkspace: {
          id: 'team-server',
          name: 'HTA Model',
          url: 'https://mim.example.com/mcp',
          namespaces: ['issues.*', 'knowledge.*'],
        },
        callerName: 'Anna',
      })
      expect(validateServeToken({ home, workspacePath, token: 'mim_serve_redeemed_token' }))
        .toMatchObject({ callerName: 'Anna' })
      expect(() => redeemServeInvite({ home, workspacePath, invite: invite.invite }))
        .toThrow(/already been used/)
      expect(listServeInvites({ home, workspacePath })[0]).toMatchObject({
        id: invite.record.id,
        redeemedAt: '2026-07-08T10:01:00.000Z',
        hash: undefined,
        secret: undefined,
        invite: undefined,
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects revoked and expired invites', () => {
    const home = mkdtempSync(join(tmpdir(), 'mim-serve-invite-'))
    const workspacePath = join(home, 'workspace')
    try {
      const revoked = createServeInvite({
        home,
        workspacePath,
        name: 'Ben',
        url: 'https://mim.example.com/mcp',
        workspaceId: 'team-server',
        workspaceName: 'Team',
        namespaces: ['issues.*'],
        secret: 'revoked_secret',
      })
      expect(revokeServeInvite({ home, workspacePath, id: revoked.record.id })).toBe(true)
      expect(() => redeemServeInvite({ home, workspacePath, invite: revoked.invite }))
        .toThrow(/revoked/)

      const expired = createServeInvite({
        home,
        workspacePath,
        name: 'Ci',
        url: 'https://mim.example.com/mcp',
        workspaceId: 'team-server',
        workspaceName: 'Team',
        namespaces: ['issues.*'],
        secret: 'expired_secret',
        expiresAt: '2026-07-08T11:00:00.000Z',
      })
      expect(() => redeemServeInvite({
        home,
        workspacePath,
        invite: expired.invite,
        now: () => new Date('2026-07-08T12:00:00.000Z'),
      })).toThrow(/expired/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
