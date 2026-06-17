import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import { readResourceBindings, resourceMountsDir } from '@main/resources/resourceModel.js'
import { registerResourceTools } from '@main/tools/resources.js'

const ctx = { actor: 'user' as const }

function gitIn(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
}

describe('resources tools', () => {
  let root: string
  let mirrors: string
  let source: string
  let tools: ReturnType<typeof createToolRegistry>
  let emit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-restools-ws-'))
    mirrors = mkdtempSync(join(tmpdir(), 'mim-restools-mirrors-'))
    source = mkdtempSync(join(tmpdir(), 'mim-restools-src-'))
    writeFileSync(join(root, 'mim.yaml'), 'name: test-ws\n')
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(root)
    emit = vi.fn()
    registerResourceTools(tools, { mirrorsDir: mirrors, emit })
  })

  afterEach(() => {
    for (const dir of [root, mirrors, source]) rmSync(dir, { recursive: true, force: true })
  })

  it('declares inputSchema on all mutating tools', () => {
    for (const name of ['resources.add', 'resources.remove', 'resources.sync', 'resources.resolvePath', 'resources.setPolicy']) {
      const def = tools.get(name)
      expect(def, name).toBeDefined()
      expect(def!.inputSchema, name).toBeDefined()
    }
  })

  it('lists no collections initially', async () => {
    const result = await tools.call('resources.collections', {}, ctx) as { collections: unknown[] }
    expect(result.collections).toEqual([])
  })

  it('adds a local folder collection: binding written, mount created, event emitted, mim.yaml untouched', async () => {
    writeFileSync(join(source, 'note.md'), 'hello')
    const result = await tools.call('resources.add', { id: 'notes', name: 'Notes', path: source }, ctx) as {
      collection: { id: string; status: string; write: string; origin: string }
    }
    expect(result.collection).toMatchObject({ id: 'notes', status: 'ok', write: 'readonly', origin: 'machine' })

    const bindings = readResourceBindings(root)
    expect(bindings.collections.notes).toMatchObject({ path: source, name: 'Notes' })

    const link = join(resourceMountsDir(root), 'notes')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(source)
    expect(readFileSync(join(link, 'note.md'), 'utf-8')).toBe('hello')

    expect(parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8')).collections).toBeUndefined()
    expect(emit).toHaveBeenCalledWith('resources:changed')
  })

  it('adds a writable local collection when write=direct is given', async () => {
    const result = await tools.call('resources.add', { id: 'snippets', path: source, write: 'direct' }, ctx) as {
      collection: { write: string }
    }
    expect(result.collection.write).toBe('direct')
  })

  it('adds a git collection into mim.yaml as not-synced without cloning', async () => {
    const result = await tools.call('resources.add', { id: 'guidance', name: 'Guidance', git: 'https://x.example/r.git' }, ctx) as {
      collection: { id: string; status: string; write: string; origin: string }
    }
    expect(result.collection).toMatchObject({ id: 'guidance', status: 'not-synced', write: 'readonly', origin: 'workspace' })
    const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
    expect(config.collections).toEqual({ guidance: { name: 'Guidance', git: 'https://x.example/r.git' } })
    expect(existsSync(join(resourceMountsDir(root), 'guidance'))).toBe(false)
  })

  it('derives an id from the name when none is given', async () => {
    const result = await tools.call('resources.add', { name: 'Journal Guidance!', path: source }, ctx) as {
      collection: { id: string }
    }
    expect(result.collection.id).toBe('journal-guidance')
  })

  it('rejects invalid add calls', async () => {
    await expect(tools.call('resources.add', { id: 'x' }, ctx)).rejects.toThrow(/either/i)
    await expect(tools.call('resources.add', { id: 'x', path: source, git: 'https://x.example/r.git' }, ctx)).rejects.toThrow(/either/i)
    await expect(tools.call('resources.add', { id: 'Bad Id', path: source }, ctx)).rejects.toThrow(/id/i)
    await expect(tools.call('resources.add', { id: 'x', path: 'relative/path' }, ctx)).rejects.toThrow(/absolute/i)
    await expect(tools.call('resources.add', { id: 'x', path: join(source, 'missing') }, ctx)).rejects.toThrow(/exist/i)
  })

  it('rejects duplicate ids across bindings and mim.yaml', async () => {
    await tools.call('resources.add', { id: 'notes', path: source }, ctx)
    await expect(tools.call('resources.add', { id: 'notes', path: source }, ctx)).rejects.toThrow(/already/i)
    await tools.call('resources.add', { id: 'guidance', git: 'https://x.example/r.git' }, ctx)
    await expect(tools.call('resources.add', { id: 'guidance', path: source }, ctx)).rejects.toThrow(/already/i)
  })

  it('binds a folder to a committed expectation instead of rejecting it as a duplicate', async () => {
    // A teammate's clone declares the collection in mim.yaml without git; adding
    // a path for that id satisfies the expectation on this machine.
    writeFileSync(join(root, 'mim.yaml'), 'name: test-ws\ncollections:\n  templates:\n    name: Templates\n')
    const before = await tools.call('resources.collections', {}, ctx) as { collections: Array<{ id: string; status: string }> }
    expect(before.collections).toMatchObject([{ id: 'templates', status: 'missing-binding' }])

    const result = await tools.call('resources.add', { id: 'templates', path: source }, ctx) as {
      collection: { id: string; status: string; origin: string; name: string }
    }
    expect(result.collection).toMatchObject({ id: 'templates', status: 'ok', origin: 'workspace', name: 'Templates' })
    expect(readResourceBindings(root).collections.templates).toMatchObject({ path: source })
    // The committed entry is untouched: still no git, no local path leaked.
    const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
    expect(config.collections).toEqual({ templates: { name: 'Templates' } })
    // But a second bind for the same id is still a duplicate.
    await expect(tools.call('resources.add', { id: 'templates', path: source }, ctx)).rejects.toThrow(/already/i)
  })

  it('setPolicy flips a local binding between readonly and direct', async () => {
    await tools.call('resources.add', { id: 'notes', path: source }, ctx)
    emit.mockClear()

    const direct = await tools.call('resources.setPolicy', { id: 'notes', write: 'direct' }, ctx) as {
      collection: { id: string; write: string }
    }
    expect(direct.collection).toMatchObject({ id: 'notes', write: 'direct' })
    expect(readResourceBindings(root).collections.notes.write).toBe('direct')
    expect(emit).toHaveBeenCalledWith('resources:changed')

    const readonly = await tools.call('resources.setPolicy', { id: 'notes', write: 'readonly' }, ctx) as {
      collection: { write: string }
    }
    expect(readonly.collection.write).toBe('readonly')
    expect(readResourceBindings(root).collections.notes.write).toBe('readonly')
  })

  it('setPolicy updates the committed policy for mim.yaml-declared local collections', async () => {
    writeFileSync(join(root, 'mim.yaml'), 'name: test-ws\ncollections:\n  templates:\n    name: Templates\n')
    await tools.call('resources.add', { id: 'templates', path: source }, ctx)

    const direct = await tools.call('resources.setPolicy', { id: 'templates', write: 'direct' }, ctx) as {
      collection: { write: string }
    }
    expect(direct.collection.write).toBe('direct')
    // Committed write wins in the merge, so the yaml entry must carry it.
    const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
    expect(config.collections?.templates).toMatchObject({ write: 'direct' })

    const readonly = await tools.call('resources.setPolicy', { id: 'templates', write: 'readonly' }, ctx) as {
      collection: { write: string }
    }
    expect(readonly.collection.write).toBe('readonly')
  })

  it('setPolicy rejects git collections and unknown ids', async () => {
    await tools.call('resources.add', { id: 'guidance', git: 'https://x.example/r.git' }, ctx)
    await expect(tools.call('resources.setPolicy', { id: 'guidance', write: 'direct' }, ctx)).rejects.toThrow(/readonly/i)
    await expect(tools.call('resources.setPolicy', { id: 'nope', write: 'direct' }, ctx)).rejects.toThrow(/unknown/i)
    await expect(tools.call('resources.setPolicy', { id: 'guidance', write: 'sometimes' }, ctx)).rejects.toThrow(/write/i)
  })

  it('removes a local collection: binding gone, mount unlinked, source untouched', async () => {
    writeFileSync(join(source, 'note.md'), 'hello')
    await tools.call('resources.add', { id: 'notes', path: source }, ctx)
    await tools.call('resources.remove', { id: 'notes' }, ctx)

    expect(readResourceBindings(root).collections).toEqual({})
    expect(existsSync(join(resourceMountsDir(root), 'notes'))).toBe(false)
    expect(readFileSync(join(source, 'note.md'), 'utf-8')).toBe('hello')
  })

  it('removes a git collection from mim.yaml', async () => {
    await tools.call('resources.add', { id: 'guidance', git: 'https://x.example/r.git' }, ctx)
    await tools.call('resources.remove', { id: 'guidance' }, ctx)
    expect(parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8')).collections).toBeUndefined()
  })

  it('rejects removing an unknown collection', async () => {
    await expect(tools.call('resources.remove', { id: 'nope' }, ctx)).rejects.toThrow(/unknown/i)
  })

  it('resolvePath returns the workspace-relative mount path and absolute root', async () => {
    await tools.call('resources.add', { id: 'notes', path: source }, ctx)
    const result = await tools.call('resources.resolvePath', { id: 'notes' }, ctx) as {
      mountPath: string; root: string; status: string
    }
    expect(result.mountPath).toBe('.mim/resources/notes')
    expect(result.root).toBe(source)
    expect(result.status).toBe('ok')
  })

  it('syncs a git collection: clones the mirror, mounts it, and pulls updates', async () => {
    // Local "remote": a real repo on disk; clone/pull via system git.
    gitIn(source, ['init', '-q'])
    gitIn(source, ['config', 'user.email', 't@example.com'])
    gitIn(source, ['config', 'user.name', 'T'])
    writeFileSync(join(source, 'guide.md'), 'v1')
    gitIn(source, ['add', '.'])
    gitIn(source, ['commit', '-q', '-m', 'v1'])

    await tools.call('resources.add', { id: 'guidance', git: source }, ctx)
    const synced = await tools.call('resources.sync', {}, ctx) as {
      results: Array<{ id: string; action: string; ok: boolean }>
    }
    expect(synced.results).toEqual([{ id: 'guidance', action: 'cloned', ok: true }])

    const link = join(resourceMountsDir(root), 'guidance')
    expect(readFileSync(join(link, 'guide.md'), 'utf-8')).toBe('v1')

    writeFileSync(join(source, 'guide.md'), 'v2')
    gitIn(source, ['add', '.'])
    gitIn(source, ['commit', '-q', '-m', 'v2'])

    const resynced = await tools.call('resources.sync', { id: 'guidance' }, ctx) as {
      results: Array<{ id: string; action: string; ok: boolean }>
    }
    expect(resynced.results).toEqual([{ id: 'guidance', action: 'pulled', ok: true }])
    expect(readFileSync(join(link, 'guide.md'), 'utf-8')).toBe('v2')
  })

  it('sync reports failures without throwing', async () => {
    await tools.call('resources.add', { id: 'broken', git: join(source, 'does-not-exist') }, ctx)
    const synced = await tools.call('resources.sync', {}, ctx) as {
      results: Array<{ id: string; ok: boolean; error?: string }>
    }
    expect(synced.results).toHaveLength(1)
    expect(synced.results[0].ok).toBe(false)
    expect(synced.results[0].error).toBeTruthy()
  })

  it('sync refreshes local mounts (a reappeared source gets mounted)', async () => {
    const missing = join(source, 'later')
    writeFileSync(join(root, '.mim'), '', { flag: 'a' })
    rmSync(join(root, '.mim'), { force: true })
    await expect(tools.call('resources.add', { id: 'later', path: missing }, ctx)).rejects.toThrow()
    mkdirSync(missing)
    await tools.call('resources.add', { id: 'later', path: missing }, ctx)
    rmSync(missing, { recursive: true, force: true })
    await tools.call('resources.sync', {}, ctx)
    expect(existsSync(join(resourceMountsDir(root), 'later'))).toBe(false)
    mkdirSync(missing)
    await tools.call('resources.sync', {}, ctx)
    expect(lstatSync(join(resourceMountsDir(root), 'later')).isSymbolicLink()).toBe(true)
  })
})
