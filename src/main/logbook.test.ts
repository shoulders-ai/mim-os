import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendLogEntry, readLogbook } from '@main/logbook.js'

const NOW = () => Date.parse('2026-06-01T12:34:56.000Z')

describe('logbook', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-logbook-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates .mim/log.md and appends a human-readable entry', () => {
    const result = appendLogEntry(dir, { actor: 'user', message: 'Started the review' }, { now: NOW })

    expect(result.path).toBe(join(dir, '.mim', 'log.md'))
    expect(result.entry).toEqual({
      ts: '2026-06-01T12:34:56.000Z',
      actor: 'user',
      message: 'Started the review',
    })

    expect(readFileSync(result.path, 'utf-8')).toBe(
      '# Log\n\n- 2026-06-01T12:34:56.000Z [user] Started the review\n',
    )
  })

  it('compacts multiline messages into a single entry line', () => {
    appendLogEntry(dir, { actor: 'ai', message: 'Line one\n\nLine two\twith space' }, { now: NOW })

    const content = readFileSync(join(dir, '.mim', 'log.md'), 'utf-8')
    expect(content).toContain('- 2026-06-01T12:34:56.000Z [ai] Line one Line two with space')
  })

  it('includes package identity when the actor is a package', () => {
    appendLogEntry(
      dir,
      { actor: 'package', package_id: 'docx-review', message: 'Generated report' },
      { now: NOW },
    )

    const content = readFileSync(join(dir, '.mim', 'log.md'), 'utf-8')
    expect(content).toContain('[package docx-review] Generated report')
  })

  it('rejects empty messages', () => {
    expect(() => appendLogEntry(dir, { actor: 'user', message: ' \n\t ' }, { now: NOW })).toThrow('message')
    expect(existsSync(join(dir, '.mim', 'log.md'))).toBe(false)
  })

  it('readLogbook returns absent without creating files', () => {
    const result = readLogbook(dir)

    expect(result).toEqual({
      path: join(dir, '.mim', 'log.md'),
      exists: false,
      content: '',
      truncated: false,
    })
    expect(existsSync(join(dir, '.mim'))).toBe(false)
  })

  it('readLogbook returns the tail when maxChars truncates', () => {
    appendLogEntry(dir, { actor: 'user', message: 'First entry' }, { now: NOW })
    appendLogEntry(dir, { actor: 'user', message: 'Second entry' }, { now: NOW })

    const result = readLogbook(dir, { maxChars: 28 })
    expect(result.exists).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.content).toContain('Second entry')
    expect(result.content.length).toBeLessThanOrEqual(28)
  })
})
