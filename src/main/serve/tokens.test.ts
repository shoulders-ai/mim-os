import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createServeRemoteGrantResolver,
  createServeToken,
  listServeCallers,
  revokeServeToken,
  rotateServeToken,
  validateServeToken,
} from '@main/serve/tokens.js'

describe('serve token store', () => {
  it('stores only token hashes and validates bearer tokens by workspace', () => {
    const home = mkdtempSync(join(tmpdir(), 'mim-serve-home-'))
    const workspacePath = join(home, 'workspace')
    try {
      const created = createServeToken({
        home,
        workspacePath,
        name: 'anna',
        token: 'mim_serve_secret_one',
        now: () => new Date('2026-07-08T10:00:00.000Z'),
      })

      expect(created.record).toMatchObject({
        id: expect.any(String),
        name: 'anna',
        createdAt: '2026-07-08T10:00:00.000Z',
        grants: {
          effects: ['read'],
          tools: expect.arrayContaining(['workspace.info', 'fs.read', 'search.files']),
          paths: ['.'],
        },
      })
      expect(created.token).toBe('mim_serve_secret_one')
      expect(created.snippets.claude).toContain('claude mcp add')
      expect(created.snippets.codex).toContain('/mcp')
      expect(created.snippets.curl).toContain('Authorization: Bearer')

      const raw = readFileSync(created.storePath, 'utf-8')
      expect(raw).not.toContain('mim_serve_secret_one')
      expect(raw).toContain(created.record.hash)

      expect(validateServeToken({ home, workspacePath, token: 'bad' })).toBeNull()
      expect(validateServeToken({ home, workspacePath, token: 'mim_serve_secret_one' })).toMatchObject({
        principal: created.record.id,
        callerName: 'anna',
        grants: created.record.grants,
      })

      const callers = listServeCallers({ home, workspacePath })
      expect(callers).toEqual([expect.objectContaining({
        id: created.record.id,
        name: 'anna',
        hash: undefined,
      })])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('revokes and rotates caller tokens', () => {
    const home = mkdtempSync(join(tmpdir(), 'mim-serve-home-'))
    const workspacePath = join(home, 'workspace')
    try {
      const created = createServeToken({
        home,
        workspacePath,
        name: 'ci',
        token: 'mim_serve_old',
        now: () => new Date('2026-07-08T10:00:00.000Z'),
      })

      const rotated = rotateServeToken({
        home,
        workspacePath,
        id: created.record.id,
        token: 'mim_serve_new',
        now: () => new Date('2026-07-08T11:00:00.000Z'),
      })

      expect(validateServeToken({ home, workspacePath, token: 'mim_serve_old' })).toBeNull()
      expect(validateServeToken({ home, workspacePath, token: 'mim_serve_new' })).toMatchObject({
        principal: created.record.id,
        callerName: 'ci',
      })
      expect(rotated.record.id).toBe(created.record.id)
      expect(rotated.record.revokedAt).toBeUndefined()

      expect(revokeServeToken({
        home,
        workspacePath,
        id: created.record.id,
        now: () => new Date('2026-07-08T12:00:00.000Z'),
      })).toBe(true)
      expect(validateServeToken({ home, workspacePath, token: 'mim_serve_new' })).toBeNull()
      expect(listServeCallers({ home, workspacePath })[0]).toMatchObject({
        id: created.record.id,
        revokedAt: '2026-07-08T12:00:00.000Z',
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('enforces tool, effect, path, and executable workspace floors in serve grants', () => {
    const home = mkdtempSync(join(tmpdir(), 'mim-serve-home-'))
    const workspacePath = join(home, 'workspace')
    try {
      const created = createServeToken({
        home,
        workspacePath,
        name: 'editor',
        token: 'mim_serve_writer',
        grants: {
          effects: ['read', 'mutate'],
          tools: ['fs.read', 'fs.write', 'skill.create'],
          paths: ['docs'],
        },
      })
      const resolver = createServeRemoteGrantResolver({ home, workspacePath })
      const ctx = {
        actor: 'remote' as const,
        principal: created.record.id,
        callerName: 'editor',
        transport: 'mcp-http',
      }

      expect(resolver({
        toolName: 'fs.read',
        params: { path: 'docs/notes.md' },
        ctx,
        policy: { category: 'read', risk: 'low', pathParam: 'path' },
        effect: 'read',
        paths: [{
          value: 'docs/notes.md',
          kind: 'workspace',
          reason: 'Within workspace',
          absolutePath: join(workspacePath, 'docs/notes.md'),
        }],
      })).toMatchObject({ allowed: true, reason: 'serve grant' })

      expect(resolver({
        toolName: 'fs.delete',
        params: { path: 'docs/notes.md' },
        ctx,
        policy: { category: 'write', risk: 'high', pathParam: 'path' },
        effect: 'mutate',
        paths: [{
          value: 'docs/notes.md',
          kind: 'workspace',
          reason: 'Within workspace',
          absolutePath: join(workspacePath, 'docs/notes.md'),
        }],
      })).toMatchObject({ allowed: false, reason: 'Grant does not include fs.delete' })

      expect(resolver({
        toolName: 'fs.write',
        params: { path: 'scratch.md' },
        ctx,
        policy: { category: 'write', risk: 'medium', pathParam: 'path' },
        effect: 'mutate',
        paths: [{
          value: 'scratch.md',
          kind: 'workspace',
          reason: 'Within workspace',
          absolutePath: join(workspacePath, 'scratch.md'),
        }],
      })).toMatchObject({ allowed: false, reason: 'Grant path scope does not include requested path' })

      expect(resolver({
        toolName: 'fs.write',
        params: { path: 'AGENTS.md' },
        ctx,
        policy: { category: 'write', risk: 'medium', pathParam: 'path' },
        effect: 'mutate',
        paths: [{
          value: 'AGENTS.md',
          kind: 'workspace',
          reason: 'Within workspace',
          absolutePath: join(workspacePath, 'AGENTS.md'),
        }],
      })).toMatchObject({
        allowed: false,
        reason: 'Remote callers cannot write executable or prompt-bearing workspace paths',
      })

      expect(resolver({
        toolName: 'skill.create',
        params: { name: 'dangerous', content: 'name: dangerous' },
        ctx,
        policy: { category: 'write', risk: 'medium', targetParam: 'name' },
        effect: 'mutate',
        paths: [],
      })).toMatchObject({
        allowed: false,
        reason: 'Remote callers cannot change executable or prompt-bearing workspace surfaces',
      })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
