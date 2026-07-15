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

  it('suppresses every new recovery capture while file recovery is disabled', () => {
    let enabled = false
    const controlled = createHistoryStore({
      getWorkspacePath: () => root,
      isEnabled: () => enabled,
      clock: () => now,
    })
    writeFileSync(join(root, 'paper.md'), 'first draft')

    expect(controlled.captureFile('paper.md', { actor: 'user', event: 'save' })).toBeNull()
    expect(controlled.baselineWorkspace()).toMatchObject({ captured: 0, truncated: false })
    const observer = controlled.toolObserver()
    const pending = observer.beforeToolCall(root, 'fs.write', { path: 'paper.md', content: 'second draft' }, { actor: 'ai' })
    writeFileSync(join(root, 'paper.md'), 'second draft')
    observer.afterToolCall(root, 'fs.write', { path: 'paper.md', content: 'second draft' }, { written: true }, { actor: 'ai' }, pending)
    expect(controlled.listFileVersions('paper.md').versions).toHaveLength(0)

    enabled = true
    expect(controlled.captureFile('paper.md', { actor: 'user', event: 'save' })).not.toBeNull()
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

  it('captures before/after versions for comment mutations so resolve is recoverable', () => {
    const withComment = 'Alpha <comment id="ab12">bravo<note by="paul" at="2026-01-01T00:00">Fix.</note></comment> charlie'
    writeFileSync(join(root, 'paper.md'), withComment)
    const observer = store.toolObserver()

    const pending = observer.beforeToolCall(
      root,
      'comments.resolve',
      { path: 'paper.md', all: true },
      { actor: 'ai' },
    )
    writeFileSync(join(root, 'paper.md'), 'Alpha bravo charlie')
    observer.afterToolCall(
      root,
      'comments.resolve',
      { path: 'paper.md', all: true },
      { path: 'paper.md', count: 1 },
      { actor: 'ai' },
      pending,
    )

    const versions = store.listFileVersions('paper.md', { includeFolded: true }).versions
    expect(versions.map(version => version.event)).toEqual(['after-edit', 'before-edit'])
    const before = versions.find(version => version.event === 'before-edit')!
    store.restoreVersion('paper.md', before.id)
    expect(readFileSync(join(root, 'paper.md'), 'utf-8')).toBe(withComment)
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
    writeFileSync(join(root, 'docs', 'source.pdf'), Buffer.from([1, 2, 3]))
    writeFileSync(join(root, 'docs', 'dataset.csv'), 'a,b\n1,2\n')
    writeFileSync(join(root, 'docs', 'events.jsonl'), '{"a":1}\n')
    writeFileSync(join(root, 'node_modules', 'pkg', 'dep.md'), '# Dependency')
    writeFileSync(join(root, '.mim', 'agent-context.md'), '# Runtime')
    writeFileSync(join(root, 'ignored.md'), '# Ignored')
    writeFileSync(join(root, 'private', 'secret.md'), '# Secret')
    writeFileSync(join(root, 'docs', 'large.md'), 'x'.repeat(1024 * 1024 + 1))

    const result = store.baselineWorkspace()
    expect(result.captured).toBe(1)
    expect(store.listFileVersions('docs/paper.md').versions).toHaveLength(1)
    expect(store.listFileVersions('docs/source.pdf').versions).toHaveLength(0)
    expect(store.listFileVersions('docs/dataset.csv').versions).toHaveLength(0)
    expect(store.listFileVersions('docs/events.jsonl').versions).toHaveLength(0)
    expect(store.listFileVersions('node_modules/pkg/dep.md').versions).toHaveLength(0)
    expect(store.listFileVersions('ignored.md').versions).toHaveLength(0)
    expect(store.listFileVersions('private/secret.md').versions).toHaveLength(0)
    expect(store.listFileVersions('docs/large.md').versions).toHaveLength(0)
  })

  it('can bound baseline work for automatic startup recovery', () => {
    mkdirSync(join(root, 'docs'), { recursive: true })
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, 'docs', `paper-${i}.md`), `# Paper ${i}`)
    }

    const result = store.baselineWorkspace({ maxCaptured: 2 })

    expect(result.captured).toBe(2)
    expect(result.truncated).toBe(true)
    const stats = store.stats()
    expect(stats.versionCount).toBe(2)
  })

  it('resumes bounded baselines instead of rescanning the same prefix forever', () => {
    mkdirSync(join(root, 'docs'), { recursive: true })
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, 'docs', `paper-${i}.md`), `# Paper ${i}`)
    }

    const first = store.baselineWorkspace({ maxScanned: 2, maxCaptured: 2 })
    const second = store.baselineWorkspace({ maxScanned: 2, maxCaptured: 2 })
    const third = store.baselineWorkspace({ maxScanned: 2, maxCaptured: 2 })

    expect(first).toMatchObject({ captured: 2, truncated: true })
    expect(second).toMatchObject({ captured: 2, truncated: true })
    expect(third).toMatchObject({ captured: 1, truncated: false })
    expect(store.stats().versionCount).toBe(5)
  })

  it('does not create history for external adds or external binary refreshes', () => {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs', 'new.md'), '# Newly downloaded')
    writeFileSync(join(root, 'docs', 'paper.pdf'), Buffer.from([1, 2, 3]))

    store.observeFileChange({ path: 'docs/new.md', kind: 'add' })
    store.observeFileChange({ path: 'docs/paper.pdf', kind: 'change' })

    expect(store.listFileVersions('docs/new.md').versions).toHaveLength(0)
    expect(store.listFileVersions('docs/paper.pdf').versions).toHaveLength(0)

    writeFileSync(join(root, 'docs', 'new.md'), '# Edited elsewhere')
    store.observeFileChange({ path: 'docs/new.md', kind: 'change' })
    expect(store.listFileVersions('docs/new.md').versions).toHaveLength(1)
  })

  it('automatically compacts old saves using the existing daily and weekly policy', () => {
    writeFileSync(join(root, 'analysis.md'), 'v0')
    const start = now - 90 * 86400000
    for (let i = 0; i < 180; i++) {
      now = start + i * Math.floor((90 * 86400000) / 180)
      writeFileSync(join(root, 'analysis.md'), `version ${i}`)
      store.captureFile('analysis.md', { actor: 'user', event: 'save' })
    }

    const retained = store.listFileVersions('analysis.md', { includeFolded: true }).versions
    expect(retained.length).toBeLessThan(90)
    expect(retained.some(version => version.at.slice(0, 10) === new Date(start).toISOString().slice(0, 10))).toBe(true)
  })

  it('treats ordinary anchors as priority rather than permanent retention', () => {
    writeFileSync(join(root, 'analysis.md'), 'v0')
    const start = now - 90 * 86400000
    for (let i = 0; i < 80; i++) {
      now = start + i * 86400000
      writeFileSync(join(root, 'analysis.md'), `agent version ${i}`)
      store.captureFile('analysis.md', { actor: 'agent', event: 'after-write', anchor: true })
    }

    const retained = store.listFileVersions('analysis.md', { includeFolded: true }).versions
    expect(retained.length).toBeLessThan(50)
  })

  it('keeps recent destructive recovery points during automatic compaction', () => {
    writeFileSync(join(root, 'notes.txt'), 'important')
    const protectedVersion = store.captureFile('notes.txt', {
      actor: 'agent',
      event: 'before-delete',
      anchor: true,
    })
    for (let i = 0; i < 60; i++) {
      now += 2 * 60 * 60 * 1000
      writeFileSync(join(root, 'notes.txt'), `rewrite ${i}`)
      store.captureFile('notes.txt', { actor: 'user', event: 'save' })
    }

    expect(store.listFileVersions('notes.txt', { includeFolded: true }).versions)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: protectedVersion!.id })]))
  })

  it('enforces a soft blob budget by evicting old low-priority versions', () => {
    store = createHistoryStore({
      getWorkspacePath: () => root,
      clock: () => now,
      maxFileBytes: 1024 * 1024,
      maxBytes: 240,
    })
    writeFileSync(join(root, 'budget.md'), 'x'.repeat(100))
    store.captureFile('budget.md', { actor: 'user', event: 'save' })
    for (let i = 1; i <= 5; i++) {
      now += 10 * 86400000
      writeFileSync(join(root, 'budget.md'), String(i).repeat(100))
      store.captureFile('budget.md', { actor: 'user', event: 'save' })
    }

    expect(store.stats().blobBytes).toBeLessThanOrEqual(240)
    expect(store.listFileVersions('budget.md', { includeFolded: true }).versions[0].bytes).toBe(100)
  })

  it('removes legacy singleton external-add anchors when the live file still exists', () => {
    writeFileSync(join(root, 'download.md'), '# Live copy')
    store.captureFile('download.md', { actor: 'external', event: 'external', anchor: true })

    const result = store.prune()

    expect(result.removedVersions).toBe(1)
    expect(store.listFileVersions('download.md', { includeFolded: true }).versions).toHaveLength(0)
    expect(readFileSync(join(root, 'download.md'), 'utf-8')).toBe('# Live copy')
  })

  // 1000 real file writes: crosses the default 5s timeout under full-suite load.
  it('folds a thousand saves into a short default rail', { timeout: 20000 }, () => {
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
    expect(defaultList.foldedCount).toBeGreaterThan(40)
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

  // 1000 real file writes: crosses the default 5s timeout under full-suite load.
  it('keeps manual pruning idempotent after automatic compaction', { timeout: 20000 }, () => {
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

    expect(before.versionCount).toBeLessThan(100)
    expect(result.removedVersions).toBe(0)
    expect(after.versionCount).toBe(before.versionCount)
    expect(store.listFileVersions('analysis.md', { includeFolded: true }).versions.length).toBe(after.versionCount)
  })
})
