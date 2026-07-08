import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { migrateServeStructuredState } from '@main/serve/stateMigration.js'

describe('serve structured-state migration', () => {
  it('copies selected app data from an existing workspace and leaves sessions, traces, and runs behind', () => {
    const root = mkdtempSync(join(tmpdir(), 'mim-serve-state-'))
    const source = join(root, 'source')
    const target = join(root, 'target')
    try {
      writeJson(join(source, '.mim/packages/board/data/collections/issues/issue-1.json'), { title: 'Existing issue' })
      writeJson(join(source, '.mim/packages/knowledge/data/collections/entries/entry-1.json'), { title: 'Existing note' })
      writeJson(join(source, '.mim/packages/references/data/kv/settings.json'), { bibPath: 'refs.bib' })
      writeJson(join(source, '.mim/packages/board/runs/run-1.json'), { status: 'done' })
      writeJson(join(source, '.mim/sessions/chat-1.json'), { title: 'Local chat' })
      writeJson(join(source, '.mim/traces/2026-07-08.jsonl'), { kind: 'tool.call' })

      const result = migrateServeStructuredState({
        sourceWorkspacePath: source,
        targetWorkspacePath: target,
      })

      expect(result.migrated).toEqual(['board', 'knowledge', 'references'])
      expect(JSON.parse(readFileSync(join(target, '.mim/packages/board/data/collections/issues/issue-1.json'), 'utf-8')))
        .toEqual({ title: 'Existing issue' })
      expect(JSON.parse(readFileSync(join(target, '.mim/packages/knowledge/data/collections/entries/entry-1.json'), 'utf-8')))
        .toEqual({ title: 'Existing note' })
      expect(JSON.parse(readFileSync(join(target, '.mim/packages/references/data/kv/settings.json'), 'utf-8')))
        .toEqual({ bibPath: 'refs.bib' })
      expect(existsSync(join(target, '.mim/packages/board/runs/run-1.json'))).toBe(false)
      expect(existsSync(join(target, '.mim/sessions/chat-1.json'))).toBe(false)
      expect(existsSync(join(target, '.mim/traces/2026-07-08.jsonl'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), 'utf-8')
}
