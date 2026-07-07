import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readManifestFile,
  rebuildManifest,
  loadManifest,
  writeManifest,
  upsertManifestEntry,
  removeManifestEntry,
  extractManifestEntry,
} from '@main/sessionManifest.js'

describe('Session manifest', () => {
  let dir: string
  let sessionsDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-manifest-test-'))
    sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeSession(id: string, label = 'Test', messages: unknown[] = []) {
    writeFileSync(join(sessionsDir, `${id}.json`), JSON.stringify({
      id,
      label,
      modelId: 'test-model',
      controlId: '',
      messages,
      usage: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.01 },
      lastContextTokens: 0,
      lastInputTokens: 0,
      archived: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))
  }

  it('readManifestFile returns null when manifest does not exist', () => {
    expect(readManifestFile(sessionsDir)).toBeNull()
  })

  it('readManifestFile returns the manifest when it exists', () => {
    writeManifest(sessionsDir, { s1: extractManifestEntry({ id: 's1', label: 'One' }) })
    const manifest = readManifestFile(sessionsDir)
    expect(manifest).not.toBeNull()
    expect(manifest!.s1.label).toBe('One')
  })

  it('readManifestFile returns null for corrupt manifest', () => {
    writeFileSync(join(sessionsDir, '_manifest.json'), 'NOT JSON{{{')
    expect(readManifestFile(sessionsDir)).toBeNull()
  })

  it('rebuildManifest scans session files and skips corrupt ones', () => {
    writeSession('s1', 'Good')
    writeSession('s2', 'Also good')
    writeFileSync(join(sessionsDir, 'bad.json'), 'CORRUPT{{{')

    const manifest = rebuildManifest(sessionsDir)
    expect(Object.keys(manifest)).toHaveLength(2)
    expect(manifest.s1.label).toBe('Good')
    expect(manifest.s2.label).toBe('Also good')
  })

  it('rebuildManifest ignores the _manifest.json file itself', () => {
    writeSession('s1', 'Only')
    writeManifest(sessionsDir, { old: extractManifestEntry({ id: 'old', label: 'Stale' }) })

    const manifest = rebuildManifest(sessionsDir)
    expect(Object.keys(manifest)).toEqual(['s1'])
  })

  it('loadManifest returns existing manifest when present', () => {
    const entry = extractManifestEntry({ id: 's1', label: 'Cached' })
    writeManifest(sessionsDir, { s1: entry })

    const manifest = loadManifest(sessionsDir)
    expect(manifest.s1.label).toBe('Cached')
  })

  it('loadManifest self-heals from session files when manifest is missing', () => {
    writeSession('s1', 'Recovered')

    const manifest = loadManifest(sessionsDir)
    expect(manifest.s1.label).toBe('Recovered')
    // Manifest should now be written to disk
    expect(existsSync(join(sessionsDir, '_manifest.json'))).toBe(true)
  })

  it('loadManifest self-heals from session files when manifest is corrupt', () => {
    writeSession('s1', 'Recovered')
    writeFileSync(join(sessionsDir, '_manifest.json'), 'CORRUPT')

    const manifest = loadManifest(sessionsDir)
    expect(manifest.s1.label).toBe('Recovered')
  })

  it('upsertManifestEntry adds a new entry', () => {
    const entry = extractManifestEntry({ id: 's1', label: 'New' })
    upsertManifestEntry(sessionsDir, 's1', entry)

    const manifest = readManifestFile(sessionsDir)!
    expect(manifest.s1.label).toBe('New')
  })

  it('upsertManifestEntry updates an existing entry', () => {
    const entry1 = extractManifestEntry({ id: 's1', label: 'V1' })
    upsertManifestEntry(sessionsDir, 's1', entry1)

    const entry2 = extractManifestEntry({ id: 's1', label: 'V2' })
    upsertManifestEntry(sessionsDir, 's1', entry2)

    const manifest = readManifestFile(sessionsDir)!
    expect(manifest.s1.label).toBe('V2')
  })

  it('removeManifestEntry removes an entry', () => {
    const entry = extractManifestEntry({ id: 's1', label: 'Doomed' })
    upsertManifestEntry(sessionsDir, 's1', entry)
    removeManifestEntry(sessionsDir, 's1')

    const manifest = readManifestFile(sessionsDir)!
    expect(manifest.s1).toBeUndefined()
  })

  it('extractManifestEntry strips messages and retains metadata', () => {
    const session = {
      id: 's1',
      label: 'Test',
      modelId: 'claude',
      controlId: 'std',
      messages: [{ id: 'm1', role: 'user', content: 'hello' }],
      usage: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.01 },
      lastContextTokens: 42,
      lastInputTokens: 10,
      archived: false,
      sortOrder: 3,
      taskLabelGenerated: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }

    const entry = extractManifestEntry(session)
    expect(entry).toEqual({
      id: 's1',
      label: 'Test',
      modelId: 'claude',
      controlId: 'std',
      usage: { inputTokens: 100, outputTokens: 50, estimatedCost: 0.01 },
      lastContextTokens: 42,
      lastInputTokens: 10,
      archived: false,
      sortOrder: 3,
      taskLabelGenerated: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    expect((entry as unknown as Record<string, unknown>).messages).toBeUndefined()
  })

  it('extractManifestEntry carries agentId when present', () => {
    const entry = extractManifestEntry({
      id: 's1',
      label: 'Agent chat',
      agentId: 'package:review-app/referee',
    })
    expect(entry.agentId).toBe('package:review-app/referee')
  })

  it('extractManifestEntry omits agentId when absent', () => {
    const entry = extractManifestEntry({
      id: 's1',
      label: 'Plain chat',
    })
    expect('agentId' in entry).toBe(false)
  })
})
