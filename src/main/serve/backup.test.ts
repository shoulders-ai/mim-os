import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { createServeBackup, restoreServeBackup } from '@main/serve/backup.js'
import { createServeToken } from '@main/serve/tokens.js'

describe('serve backup and restore', () => {
  it('round-trips structured workspace state and serve caller config', () => {
    const root = mkdtempSync(join(tmpdir(), 'mim-serve-backup-'))
    const workspace = join(root, 'workspace')
    const restored = join(root, 'restored')
    const home = join(root, 'home')
    const restoreHome = join(root, 'restore-home')
    const backupDir = join(root, 'backup')
    try {
      writeJson(join(workspace, '.mim/packages/board/data/collections/issues/issue-1.json'), { title: 'Issue' })
      writeJson(join(workspace, '.mim/sessions/chat-1.json'), { title: 'Chat' })
      writeJson(join(workspace, '.mim/traces/2026-07-08.jsonl'), { kind: 'tool.call' })
      writeJson(join(workspace, '.mim/settings.json'), { traceRetentionDays: 30 })
      createServeToken({ home, workspacePath: workspace, name: 'anna', token: 'mim_serve_secret' })

      const created = createServeBackup({ home, workspacePath: workspace, outputPath: backupDir })
      expect(existsSync(join(created.path, 'workspace/packages/board/data/collections/issues/issue-1.json'))).toBe(true)
      expect(existsSync(join(created.path, 'serve/callers.json'))).toBe(true)

      const restoredResult = restoreServeBackup({ home: restoreHome, workspacePath: restored, backupPath: backupDir })

      expect(restoredResult.restored).toEqual(expect.arrayContaining(['packages', 'sessions', 'traces', 'settings.json', 'serve']))
      expect(JSON.parse(readFileSync(join(restored, '.mim/packages/board/data/collections/issues/issue-1.json'), 'utf-8')))
        .toEqual({ title: 'Issue' })
      expect(JSON.parse(readFileSync(join(restored, '.mim/sessions/chat-1.json'), 'utf-8')))
        .toEqual({ title: 'Chat' })
      expect(readFileSync(join(restored, '.mim/traces/2026-07-08.jsonl'), 'utf-8'))
        .toBe('{"kind":"tool.call"}')
      expect(readFileSync(restoredResult.servePath, 'utf-8')).toContain('anna')
      expect(readFileSync(restoredResult.servePath, 'utf-8')).not.toContain('mim_serve_secret')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), 'utf-8')
}
