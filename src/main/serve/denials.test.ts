import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  listServeDeniedRequests,
  recordServeDeniedRequest,
} from '@main/serve/denials.js'

describe('serve denial ledger', () => {
  it('records remote denial events without requiring trace lookup', () => {
    const home = mkdtempSync(join(tmpdir(), 'mim-serve-home-'))
    const workspacePath = join(home, 'workspace')
    try {
      const entry = recordServeDeniedRequest({
        home,
        workspacePath,
        now: () => new Date('2026-07-08T10:00:00.000Z'),
        event: {
          decision: 'denied',
          tool: 'fs.write',
          actor: 'remote',
          principal: 'caller_anna',
          callerName: 'anna',
          transport: 'mcp-http',
          category: 'write',
          risk: 'medium',
          mode: 'normal',
          reason: 'Grant does not include mutate effects',
          target: '/workspace/docs/notes.md',
          pathKind: 'workspace',
          params: { path: 'docs/notes.md', content: '[redacted]' },
        },
      })

      expect(entry).toMatchObject({
        id: expect.any(String),
        createdAt: '2026-07-08T10:00:00.000Z',
        principal: 'caller_anna',
        callerName: 'anna',
        tool: 'fs.write',
        reason: 'Grant does not include mutate effects',
      })
      expect(listServeDeniedRequests({ home, workspacePath })).toEqual([entry])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
