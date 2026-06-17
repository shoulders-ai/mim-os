import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createHistoryStore,
  isHistoryEligiblePath,
  type HistoryStore,
} from './history.js'

describe('workspace history store', () => {
  let root: string
  let now = 1_700_000_000_000
  let store: HistoryStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-history-'))
    store = createHistoryStore({
      getWorkspacePath: () => root,
      clock: () => now,
      maxFileBytes: 1024 * 1024,
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('records eligible file versions and restores text content', () => {
    writeFileSync(join(root, 'paper.md'), 'first draft')
    const first = store.captureFile('paper.md', { actor: 'user', event: 'baseline' })
    expect(first?.hash).toBeTruthy()

    now += 60_000
    writeFileSync(join(root, 'paper.md'), 'second draft')
    const second = store.captureFile('paper.md', { actor: 'user', event: 'save' })
    expect(second?.hash).not.toBe(first?.hash)

    const list = store.listFileVersions('paper.md')
    expect(list.current?.hash).toBe(second?.hash)
    expect(list.versions.map(version => version.event)).toContain('baseline')

    store.restoreVersion('paper.md', first!.id)
    expect(readFileSync(join(root, 'paper.md'), 'utf-8')).toBe('first draft')

    const afterRestore = store.listFileVersions('paper.md')
    expect(afterRestore.versions[0].event).toBe('restore')
  })

  it('stores binary artifacts and restores them without text decoding', () => {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'model.xlsx'), Buffer.from([0, 1, 2, 3]))
    const first = store.captureFile('docs/model.xlsx', { actor: 'external', event: 'external' })

    writeFileSync(join(root, 'docs', 'model.xlsx'), Buffer.from([9, 8, 7]))
    store.captureFile('docs/model.xlsx', { actor: 'external', event: 'external' })

    const preview = store.previewVersion('docs/model.xlsx', first!.id)
    expect(preview.kind).toBe('binary')
    expect(preview.bytes).toBe(4)

    store.restoreVersion('docs/model.xlsx', first!.id)
    expect([...readFileSync(join(root, 'docs', 'model.xlsx'))]).toEqual([0, 1, 2, 3])
  })

  it('captures fs.writeBytes before and after versions for binary recovery', () => {
    mkdirSync(join(root, 'references', 'pdf'), { recursive: true })
    writeFileSync(join(root, 'references', 'pdf', 'paper.pdf'), Buffer.from([1, 2, 3]))
    const observer = store.toolObserver()

    const pending = observer.beforeToolCall(
      root,
      'fs.writeBytes',
      { path: 'references/pdf/paper.pdf', base64: Buffer.from([9, 8]).toString('base64') },
      { actor: 'package', package_id: 'references' },
    )
    writeFileSync(join(root, 'references', 'pdf', 'paper.pdf'), Buffer.from([9, 8]))
    observer.afterToolCall(
      root,
      'fs.writeBytes',
      { path: 'references/pdf/paper.pdf', base64: Buffer.from([9, 8]).toString('base64') },
      { written: 'references/pdf/paper.pdf' },
      { actor: 'package', package_id: 'references' },
      pending,
    )

    const versions = store.listFileVersions('references/pdf/paper.pdf', { includeFolded: true }).versions
    expect(versions.map(version => version.event)).toEqual(['after-write', 'before-write'])
    const before = versions.find(version => version.event === 'before-write')!
    store.restoreVersion('references/pdf/paper.pdf', before.id)
    expect([...readFileSync(join(root, 'references', 'pdf', 'paper.pdf'))]).toEqual([1, 2, 3])
  })

  it('records a pre-delete anchor so deleted files can be restored', () => {
    writeFileSync(join(root, 'notes.txt'), 'keep me')
    const first = store.captureFile('notes.txt', { actor: 'ai', event: 'before-delete', anchor: true })
    rmSync(join(root, 'notes.txt'))
    store.captureDeletion('notes.txt', { actor: 'ai', event: 'delete', anchor: true })

    const list = store.listFileVersions('notes.txt')
    expect(list.current?.deleted).toBe(true)
    expect(list.versions.some(version => version.event === 'before-delete')).toBe(true)

    store.restoreVersion('notes.txt', first!.id)
    expect(readFileSync(join(root, 'notes.txt'), 'utf-8')).toBe('keep me')
  })

  it('baselines eligible files while ignoring generated, runtime, ignored, and oversized files', () => {
    mkdirSync(join(root, 'docs'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, '.mim'), { recursive: true })
    writeFileSync(join(root, '.gitignore'), 'ignored.md\n')
    writeFileSync(join(root, '.mim', 'historyignore'), 'private/*.md\n')
    mkdirSync(join(root, 'private'), { recursive: true })

    writeFileSync(join(root, 'docs', 'paper.md'), '# Paper')
    writeFileSync(join(root, 'node_modules', 'pkg', 'dep.md'), '# Dependency')
    writeFileSync(join(root, '.mim', 'agent-context.md'), '# Runtime')
    writeFileSync(join(root, 'ignored.md'), '# Ignored')
    writeFileSync(join(root, 'private', 'secret.md'), '# Secret')
    writeFileSync(join(root, 'docs', 'large.md'), 'x'.repeat(1024 * 1024 + 1))

    const result = store.baselineWorkspace()
    expect(result.captured).toBe(1)
    expect(store.listFileVersions('docs/paper.md').versions).toHaveLength(1)
    expect(store.listFileVersions('node_modules/pkg/dep.md').versions).toHaveLength(0)
    expect(store.listFileVersions('ignored.md').versions).toHaveLength(0)
    expect(store.listFileVersions('private/secret.md').versions).toHaveLength(0)
    expect(store.listFileVersions('docs/large.md').versions).toHaveLength(0)
  })

  it('folds a thousand saves into a short default rail', () => {
    writeFileSync(join(root, 'analysis.md'), 'v0')
    const start = now - 90 * 86400000
    for (let i = 0; i < 1000; i++) {
      now = start + i * Math.floor((90 * 86400000) / 1000)
      writeFileSync(join(root, 'analysis.md'), `version ${i}`)
      store.captureFile('analysis.md', { actor: 'user', event: 'save' })
    }

    const defaultList = store.listFileVersions('analysis.md')
    const expandedList = store.listFileVersions('analysis.md', { includeFolded: true })

    expect(defaultList.versions.length).toBeLessThanOrEqual(30)
    expect(defaultList.foldedCount).toBeGreaterThan(900)
    expect(expandedList.versions.length).toBeGreaterThan(defaultList.versions.length)
    expect(defaultList.versions[0].path).toBe('analysis.md')
  })

  it('keeps eligibility decisions explicit and product-scoped', () => {
    expect(isHistoryEligiblePath('paper.md')).toBe(true)
    expect(isHistoryEligiblePath('data/model.xlsx')).toBe(true)
    expect(isHistoryEligiblePath('analysis/run.Rmd')).toBe(true)
    expect(isHistoryEligiblePath('dist/generated.md')).toBe(false)
    expect(isHistoryEligiblePath('.mim/settings.json')).toBe(false)
    expect(isHistoryEligiblePath('node_modules/pkg/index.md')).toBe(false)
    expect(isHistoryEligiblePath('archive.zip')).toBe(false)
  })

  it('clears local recovery storage without touching workspace files', () => {
    writeFileSync(join(root, 'paper.md'), 'draft')
    store.captureFile('paper.md', { actor: 'user', event: 'save' })

    const statsBefore = store.stats()
    expect(statsBefore.versionCount).toBe(1)
    expect(existsSync(join(root, 'paper.md'))).toBe(true)

    store.clear()

    expect(readFileSync(join(root, 'paper.md'), 'utf-8')).toBe('draft')
    expect(store.stats().versionCount).toBe(0)
  })

  it('writes a version to a temporary file without changing the workspace file', () => {
    writeFileSync(join(root, 'paper.md'), 'old')
    const old = store.captureFile('paper.md', { actor: 'user', event: 'save' })
    writeFileSync(join(root, 'paper.md'), 'new')
    store.captureFile('paper.md', { actor: 'user', event: 'save' })

    const temp = store.writeVersionTempFile('paper.md', old!.id)

    expect(readFileSync(temp.path, 'utf-8')).toBe('old')
    expect(readFileSync(join(root, 'paper.md'), 'utf-8')).toBe('new')
  })

  it('physically prunes folded versions and garbage-collects unused blobs', () => {
    writeFileSync(join(root, 'analysis.md'), 'v0')
    const start = now - 90 * 86400000
    for (let i = 0; i < 1000; i++) {
      now = start + i * Math.floor((90 * 86400000) / 1000)
      writeFileSync(join(root, 'analysis.md'), `version ${i}`)
      store.captureFile('analysis.md', { actor: 'user', event: 'save' })
    }

    const before = store.stats()
    const result = store.prune()
    const after = store.stats()

    expect(result.removedVersions).toBeGreaterThan(900)
    expect(after.versionCount).toBeLessThan(before.versionCount)
    expect(store.listFileVersions('analysis.md', { includeFolded: true }).versions.length).toBe(after.versionCount)
  })
})
