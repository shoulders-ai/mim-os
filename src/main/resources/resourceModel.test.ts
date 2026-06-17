import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, lstatSync, readlinkSync, existsSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseResourceBindings,
  serializeResourceBindings,
  mirrorDirFor,
  resolveCollections,
  syncMounts,
  resourceMountsDir,
  resourceMountSymlinkType,
} from '@main/resources/resourceModel.js'
import type { MimConfig } from '@main/workspace/workspaceContract.js'

describe('resourceModel — bindings parse/serialize', () => {
  it('round-trips bindings', () => {
    const bindings = {
      collections: {
        templates: { path: '/x/templates' },
        'my-notes': { path: '/x/notes', name: 'My notes', write: 'direct' as const },
      },
    }
    expect(parseResourceBindings(serializeResourceBindings(bindings))).toEqual(bindings)
  })

  it('returns empty bindings for invalid JSON', () => {
    expect(parseResourceBindings('{nope')).toEqual({ collections: {} })
  })

  it('returns empty bindings for an empty string', () => {
    expect(parseResourceBindings('')).toEqual({ collections: {} })
  })

  it('drops entries without a string path', () => {
    const parsed = parseResourceBindings(JSON.stringify({ collections: { a: { path: 7 }, b: true, c: { path: '/ok' } } }))
    expect(parsed).toEqual({ collections: { c: { path: '/ok' } } })
  })

  it('drops invalid write policies and ids', () => {
    const parsed = parseResourceBindings(JSON.stringify({
      collections: {
        'Bad Id': { path: '/x' },
        ok: { path: '/x', write: 'yolo' },
      },
    }))
    expect(parsed).toEqual({ collections: { ok: { path: '/x' } } })
  })
})

describe('resourceModel — mirrorDirFor', () => {
  it('is stable for the same URL', () => {
    expect(mirrorDirFor('/m', 'https://x.example/r.git')).toBe(mirrorDirFor('/m', 'https://x.example/r.git'))
  })

  it('differs for different URLs', () => {
    expect(mirrorDirFor('/m', 'https://x.example/a.git')).not.toBe(mirrorDirFor('/m', 'https://x.example/b.git'))
  })

  it('lives under the mirrors dir', () => {
    expect(mirrorDirFor('/m', 'https://x.example/a.git').startsWith('/m/')).toBe(true)
  })
})

describe('resourceModel — resolveCollections', () => {
  let ws: string
  let mirrors: string
  let source: string

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'mim-res-ws-'))
    mirrors = mkdtempSync(join(tmpdir(), 'mim-res-mirrors-'))
    source = mkdtempSync(join(tmpdir(), 'mim-res-src-'))
  })

  afterEach(() => {
    for (const dir of [ws, mirrors, source]) rmSync(dir, { recursive: true, force: true })
  })

  function resolve(config: MimConfig, bindings = { collections: {} as Record<string, { path: string; name?: string; write?: 'readonly' | 'direct' }> }) {
    return resolveCollections({ workspaceDir: ws, config, bindings, mirrorsDir: mirrors })
  }

  it('resolves a git entry to a git_repo collection with a mirror root', () => {
    const url = 'https://x.example/guidance.git'
    const [c] = resolve({ name: 'x', collections: { guidance: { name: 'Guidance', git: url } } })
    expect(c.id).toBe('guidance')
    expect(c.name).toBe('Guidance')
    expect(c.source).toEqual({ kind: 'git_repo', location: url })
    expect(c.root).toBe(mirrorDirFor(mirrors, url))
    expect(c.origin).toBe('workspace')
  })

  it('git collections are not-synced until the mirror exists, then ok', () => {
    const url = 'https://x.example/guidance.git'
    const config: MimConfig = { name: 'x', collections: { guidance: { git: url } } }
    expect(resolve(config)[0].status).toBe('not-synced')
    mkdirSync(mirrorDirFor(mirrors, url), { recursive: true })
    expect(resolve(config)[0].status).toBe('ok')
  })

  it('forces git collections to readonly even if config says direct', () => {
    const [c] = resolve({ name: 'x', collections: { g: { git: 'https://x.example/r.git', write: 'direct' } } })
    expect(c.write).toBe('readonly')
  })

  it('marks an unsatisfied expectation as missing-binding', () => {
    const [c] = resolve({ name: 'x', collections: { templates: { name: 'Templates' } } })
    expect(c.status).toBe('missing-binding')
    expect(c.source).toBeNull()
    expect(c.root).toBeNull()
  })

  it('satisfies an expectation from a machine binding', () => {
    const [c] = resolve(
      { name: 'x', collections: { templates: { name: 'Templates', write: 'direct' } } },
      { collections: { templates: { path: source } } },
    )
    expect(c.status).toBe('ok')
    expect(c.source).toEqual({ kind: 'local_folder', location: source })
    expect(c.root).toBe(source)
    expect(c.write).toBe('direct')
    expect(c.origin).toBe('workspace')
  })

  it('committed write policy wins over the binding policy', () => {
    const [c] = resolve(
      { name: 'x', collections: { templates: { write: 'readonly' } } },
      { collections: { templates: { path: source, write: 'direct' } } },
    )
    expect(c.write).toBe('readonly')
  })

  it('falls back to the binding policy when the committed entry is silent', () => {
    const [c] = resolve(
      { name: 'x', collections: { templates: {} } },
      { collections: { templates: { path: source, write: 'direct' } } },
    )
    expect(c.write).toBe('direct')
  })

  it('defaults to readonly when nobody declares a policy', () => {
    const [c] = resolve(
      { name: 'x', collections: { templates: {} } },
      { collections: { templates: { path: source } } },
    )
    expect(c.write).toBe('readonly')
  })

  it('resolves a binding without a committed entry as a personal machine collection', () => {
    const [c] = resolve(
      { name: 'x' },
      { collections: { 'my-notes': { path: source, name: 'My notes', write: 'direct' } } },
    )
    expect(c.id).toBe('my-notes')
    expect(c.name).toBe('My notes')
    expect(c.origin).toBe('machine')
    expect(c.write).toBe('direct')
    expect(c.status).toBe('ok')
  })

  it('marks a binding whose path does not exist as missing-source', () => {
    const [c] = resolve(
      { name: 'x' },
      { collections: { gone: { path: join(source, 'nope') } } },
    )
    expect(c.status).toBe('missing-source')
  })

  it('uses the id as display name when none is given', () => {
    const [c] = resolve({ name: 'x', collections: { templates: {} } })
    expect(c.name).toBe('templates')
  })

  it('computes mountPath under .mim/resources', () => {
    const [c] = resolve({ name: 'x', collections: { templates: {} } })
    expect(c.mountPath).toBe(join(resourceMountsDir(ws), 'templates'))
  })
})

describe('resourceModel — syncMounts', () => {
  let ws: string
  let mirrors: string
  let source: string

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'mim-res-ws-'))
    mirrors = mkdtempSync(join(tmpdir(), 'mim-res-mirrors-'))
    source = mkdtempSync(join(tmpdir(), 'mim-res-src-'))
  })

  afterEach(() => {
    for (const dir of [ws, mirrors, source]) rmSync(dir, { recursive: true, force: true })
  })

  function resolved(config: MimConfig, bindings: Parameters<typeof resolveCollections>[0]['bindings']) {
    return resolveCollections({ workspaceDir: ws, config, bindings, mirrorsDir: mirrors })
  }

  it('creates a symlink for an ok collection', () => {
    const collections = resolved({ name: 'x' }, { collections: { templates: { path: source } } })
    const result = syncMounts(ws, collections)
    const link = join(resourceMountsDir(ws), 'templates')
    expect(result.mounted).toEqual(['templates'])
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(source)
  })

  it('is idempotent', () => {
    const collections = resolved({ name: 'x' }, { collections: { templates: { path: source } } })
    syncMounts(ws, collections)
    const result = syncMounts(ws, collections)
    expect(result.mounted).toEqual(['templates'])
    expect(readlinkSync(join(resourceMountsDir(ws), 'templates'))).toBe(source)
  })

  it('retargets a symlink whose backing root changed', () => {
    const other = mkdtempSync(join(tmpdir(), 'mim-res-src2-'))
    try {
      syncMounts(ws, resolved({ name: 'x' }, { collections: { templates: { path: source } } }))
      syncMounts(ws, resolved({ name: 'x' }, { collections: { templates: { path: other } } }))
      expect(readlinkSync(join(resourceMountsDir(ws), 'templates'))).toBe(other)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('removes stale symlinks for collections that no longer exist', () => {
    syncMounts(ws, resolved({ name: 'x' }, { collections: { templates: { path: source } } }))
    const result = syncMounts(ws, resolved({ name: 'x' }, { collections: {} }))
    expect(result.removed).toEqual(['templates'])
    expect(existsSync(join(resourceMountsDir(ws), 'templates'))).toBe(false)
  })

  it('removes the symlink when a collection is no longer ok', () => {
    syncMounts(ws, resolved({ name: 'x' }, { collections: { templates: { path: source } } }))
    const gone = resolved({ name: 'x' }, { collections: { templates: { path: join(source, 'nope') } } })
    syncMounts(ws, gone)
    expect(existsSync(join(resourceMountsDir(ws), 'templates'))).toBe(false)
  })

  it('leaves a non-symlink entry in the mounts dir alone and reports it', () => {
    mkdirSync(join(resourceMountsDir(ws), 'templates'), { recursive: true })
    writeFileSync(join(resourceMountsDir(ws), 'templates', 'real-file.md'), 'x')
    const collections = resolved({ name: 'x' }, { collections: { templates: { path: source } } })
    const result = syncMounts(ws, collections)
    expect(result.conflicts).toEqual(['templates'])
    expect(lstatSync(join(resourceMountsDir(ws), 'templates')).isDirectory()).toBe(true)
  })

  it('does not remove foreign symlinks outside the mounts dir', () => {
    // A symlink elsewhere in .mim must be untouched by mount syncing.
    const foreign = join(ws, '.mim', 'other-link')
    mkdirSync(join(ws, '.mim'), { recursive: true })
    symlinkSync(source, foreign)
    syncMounts(ws, resolved({ name: 'x' }, { collections: {} }))
    expect(lstatSync(foreign).isSymbolicLink()).toBe(true)
  })

  it('uses junction mount type on Windows and directory symlinks elsewhere', () => {
    expect(resourceMountSymlinkType('win32')).toBe('junction')
    expect(resourceMountSymlinkType('linux')).toBe('dir')
    expect(resourceMountSymlinkType('darwin')).toBe('dir')
  })
})
