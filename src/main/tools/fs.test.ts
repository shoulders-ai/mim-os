import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerFileTools } from '@main/tools/fs.js'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MAX_ATTACHMENT_BYTES } from '@main/attachments.js'

describe('File tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  let openNativeFile: ReturnType<typeof vi.fn>
  let trashItem: ReturnType<typeof vi.fn>
  let onUserTrashed: ReturnType<typeof vi.fn>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-fs-test-'))
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)
    openNativeFile = vi.fn(async () => '')
    trashItem = vi.fn(async (path: string) => { rmSync(path, { recursive: true, force: true }) })
    onUserTrashed = vi.fn()
    registerFileTools(tools, { openNativeFile, trashItem, onUserTrashed })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('fs.write creates a file and fs.read reads it', async () => {
    await tools.call('fs.write', { path: 'test.md', content: '# Hello' }, ctx)
    const result = await tools.call('fs.read', { path: 'test.md' }, ctx) as {
      content: string
      hash: string
      version: { hash: string; size: number; mtimeMs: number }
      total_lines: number
      start_line: number
      end_line: number
      truncated: boolean
    }
    expect(result.content).toBe('# Hello')
    expect(result.hash).toEqual(expect.any(String))
    expect(result.version).toMatchObject({
      hash: result.hash,
      size: '# Hello'.length,
      mtimeMs: expect.any(Number),
    })
    expect(result.total_lines).toBe(1)
    expect(result.start_line).toBe(1)
    expect(result.end_line).toBe(1)
    expect(result.truncated).toBe(false)
  })

  it('fs.write refuses to overwrite when expected_hash is stale', async () => {
    writeFileSync(join(dir, 'guarded.md'), 'old')
    const read = await tools.call('fs.read', { path: 'guarded.md' }, ctx) as { hash: string }
    writeFileSync(join(dir, 'guarded.md'), 'external')

    await expect(
      tools.call('fs.write', {
        path: 'guarded.md',
        content: 'mine',
        expected_hash: read.hash,
      }, ctx),
    ).rejects.toThrow('changed on disk')
    expect(readFileSync(join(dir, 'guarded.md'), 'utf-8')).toBe('external')
  })

  it('fs.read returns a structured line window without modifying content', async () => {
    writeFileSync(join(dir, 'lines.txt'), 'one\ntwo\nthree\nfour')

    const result = await tools.call('fs.read', {
      path: 'lines.txt',
      start_line: 2,
      limit: 2,
    }, ctx) as {
      content: string
      total_lines: number
      start_line: number
      end_line: number
      truncated: boolean
    }

    expect(result).toMatchObject({
      content: 'two\nthree',
      total_lines: 4,
      start_line: 2,
      end_line: 3,
      truncated: true,
    })
  })

  it('fs.read truncates by max_chars and reports metadata outside content', async () => {
    writeFileSync(join(dir, 'large.txt'), 'abcdef')

    const result = await tools.call('fs.read', {
      path: 'large.txt',
      max_chars: 3,
    }, ctx) as { content: string; truncated: boolean; total_chars: number }

    expect(result.content).toBe('abc')
    expect(result.truncated).toBe(true)
    expect(result.total_chars).toBe(6)
  })

  it('fs.readImageDataUrl returns image bytes as a data URL', async () => {
    mkdirSync(join(dir, 'images'), { recursive: true })
    writeFileSync(join(dir, 'images/pixel.png'), Buffer.from([0, 1, 2, 3]))

    const result = await tools.call('fs.readImageDataUrl', {
      path: 'images/pixel.png',
    }, ctx) as { mediaType: string; dataUrl: string; size: number; path: string }

    expect(result).toEqual({
      path: 'images/pixel.png',
      mediaType: 'image/png',
      size: 4,
      dataUrl: 'data:image/png;base64,AAECAw==',
    })
  })

  it('fs.readImageDataUrl serves SVG with its own media type', async () => {
    writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')

    const result = await tools.call('fs.readImageDataUrl', {
      path: 'logo.svg',
    }, ctx) as { mediaType: string; dataUrl: string }

    expect(result.mediaType).toBe('image/svg+xml')
    expect(result.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('fs.readImageDataUrl rejects non-image files', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'hello')

    await expect(
      tools.call('fs.readImageDataUrl', { path: 'notes.txt' }, ctx),
    ).rejects.toThrow('not a supported image')
  })

  it('fs.readImageDataUrl rejects path traversal', async () => {
    await expect(
      tools.call('fs.readImageDataUrl', { path: '../outside.png' }, ctx),
    ).rejects.toThrow('traversal')
  })

  it('fs.readImageDataUrl rejects oversized images', async () => {
    writeFileSync(join(dir, 'large.png'), Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))

    await expect(
      tools.call('fs.readImageDataUrl', { path: 'large.png' }, ctx),
    ).rejects.toThrow('too large')
  })

  it('fs.write creates parent directories', async () => {
    await tools.call('fs.write', { path: 'deep/nested/file.txt', content: 'ok' }, ctx)
    expect(readFileSync(join(dir, 'deep/nested/file.txt'), 'utf-8')).toBe('ok')
  })

  it('fs.writeBytes writes base64 bytes and returns binary version metadata', async () => {
    const bytes = Buffer.from([0, 1, 2, 3, 254, 255])

    const result = await tools.call('fs.writeBytes', {
      path: 'references/pdf/source.pdf',
      base64: bytes.toString('base64'),
    }, ctx) as {
      written: string
      hash: string
      version: { hash: string; size: number; mtimeMs: number }
    }

    expect([...readFileSync(join(dir, 'references/pdf/source.pdf'))]).toEqual([...bytes])
    expect(result).toMatchObject({
      written: 'references/pdf/source.pdf',
      hash: expect.any(String),
      version: {
        hash: result.hash,
        size: bytes.length,
        mtimeMs: expect.any(Number),
      },
    })
  })

  it('fs.writeBytes rejects invalid base64 and leaves no partial file', async () => {
    await expect(
      tools.call('fs.writeBytes', { path: 'bad.bin', base64: 'not base64!' }, ctx),
    ).rejects.toThrow('base64')

    expect(existsSync(join(dir, 'bad.bin'))).toBe(false)
  })

  it('fs.writeBytes rejects oversized payloads', async () => {
    const tooLarge = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64')

    await expect(
      tools.call('fs.writeBytes', { path: 'large.bin', base64: tooLarge }, ctx),
    ).rejects.toThrow('too large')
  })

  it('fs.writeBytes rejects path traversal', async () => {
    await expect(
      tools.call('fs.writeBytes', { path: '../outside.bin', base64: 'AA==' }, ctx),
    ).rejects.toThrow('traversal')
  })

  it('fs.create fails if file exists', async () => {
    await tools.call('fs.create', { path: 'exists.md', content: 'first' }, ctx)
    await expect(
      tools.call('fs.create', { path: 'exists.md', content: 'second' }, ctx)
    ).rejects.toThrow('already exists')
  })

  it('fs.delete removes a file', async () => {
    writeFileSync(join(dir, 'to-delete.txt'), 'bye')
    await tools.call('fs.delete', { path: 'to-delete.txt' }, ctx)
    expect(existsSync(join(dir, 'to-delete.txt'))).toBe(false)
  })

  it('fs.delete refuses directories', async () => {
    mkdirSync(join(dir, 'dir-to-keep'))

    await expect(
      tools.call('fs.delete', { path: 'dir-to-keep' }, ctx)
    ).rejects.toThrow('Cannot delete directories')
    expect(existsSync(join(dir, 'dir-to-keep'))).toBe(true)
  })

  it('fs.list returns directory entries with time metadata', async () => {
    writeFileSync(join(dir, 'a.md'), 'a')
    writeFileSync(join(dir, 'b.txt'), 'b')
    const result = await tools.call('fs.list', { path: '.' }, ctx) as {
      entries: Array<{
        name: string
        path: string
        type: string
        modifiedAt?: string
        createdAt?: string
      }>
    }
    const names = result.entries.map(e => e.name).sort()
    expect(names).toContain('a.md')
    expect(names).toContain('b.txt')
    const entry = result.entries.find(e => e.name === 'a.md')
    expect(entry?.path).toBe('a.md')
    expect(entry?.modifiedAt).toEqual(expect.any(String))
    expect(entry?.createdAt).toEqual(expect.any(String))
    expect(Number.isNaN(Date.parse(entry!.modifiedAt!))).toBe(false)
    expect(Number.isNaN(Date.parse(entry!.createdAt!))).toBe(false)
  })

  it('fs.list supports recursive glob filtering with a cap', async () => {
    mkdirSync(join(dir, 'docs/nested'), { recursive: true })
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true })
    writeFileSync(join(dir, 'docs/a.md'), 'a')
    writeFileSync(join(dir, 'docs/b.txt'), 'b')
    writeFileSync(join(dir, 'docs/nested/c.md'), 'c')
    writeFileSync(join(dir, 'node_modules/pkg/ignored.md'), 'ignore')

    const result = await tools.call('fs.list', {
      path: '.',
      recursive: true,
      pattern: '**/*.md',
      max_entries: 1,
    }, ctx) as {
      entries: Array<{ path: string }>
      truncated: boolean
      limit: number
    }

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].path).toBe('docs/a.md')
    expect(result.truncated).toBe(true)
    expect(result.limit).toBe(1)
  })

  it('fs.list returns an empty missing result when a listed directory vanished', async () => {
    mkdirSync(join(dir, 'transient'))
    rmSync(join(dir, 'transient'), { recursive: true, force: true })

    const result = await tools.call('fs.list', { path: 'transient' }, ctx) as {
      entries: unknown[]
      missing?: boolean
      truncated: boolean
    }

    expect(result.entries).toEqual([])
    expect(result.missing).toBe(true)
    expect(result.truncated).toBe(false)
  })

  it('fs.exists checks file existence', async () => {
    writeFileSync(join(dir, 'real.md'), 'yes')
    const yes = await tools.call('fs.exists', { path: 'real.md' }, ctx) as { exists: boolean }
    const no = await tools.call('fs.exists', { path: 'fake.md' }, ctx) as { exists: boolean }
    expect(yes.exists).toBe(true)
    expect(no.exists).toBe(false)
  })

  it('fs.openNative opens a workspace file with the configured native opener', async () => {
    writeFileSync(join(dir, 'reviewed.docx'), 'docx')

    const result = await tools.call('fs.openNative', { path: 'reviewed.docx' }, ctx) as { opened: string }

    expect(result.opened).toBe('reviewed.docx')
    expect(openNativeFile).toHaveBeenCalledWith(join(dir, 'reviewed.docx'))
  })

  it('fs.openNative rejects path traversal', async () => {
    await expect(
      tools.call('fs.openNative', { path: '../outside.docx' }, ctx),
    ).rejects.toThrow('traversal')
    expect(openNativeFile).not.toHaveBeenCalled()
  })

  it('fs.mkdir creates directories recursively without deleting files', async () => {
    await tools.call('fs.mkdir', { path: 'deep/new/dir' }, ctx)
    expect(existsSync(join(dir, 'deep/new/dir'))).toBe(true)

    writeFileSync(join(dir, 'existing-file'), 'keep')
    await expect(
      tools.call('fs.mkdir', { path: 'existing-file' }, ctx)
    ).rejects.toThrow('already exists as a file')
    expect(readFileSync(join(dir, 'existing-file'), 'utf-8')).toBe('keep')
  })

  it('fs.rename moves a path and refuses to overwrite', async () => {
    writeFileSync(join(dir, 'old.md'), 'old')
    writeFileSync(join(dir, 'taken.md'), 'taken')

    await expect(
      tools.call('fs.rename', { old_path: 'old.md', new_path: 'taken.md' }, ctx)
    ).rejects.toThrow('Destination already exists')

    const result = await tools.call('fs.rename', {
      old_path: 'old.md',
      new_path: 'nested/new.md',
    }, ctx) as { renamed: { from: string; to: string } }

    expect(result.renamed).toEqual({ from: 'old.md', to: 'nested/new.md' })
    expect(existsSync(join(dir, 'old.md'))).toBe(false)
    expect(readFileSync(join(dir, 'nested/new.md'), 'utf-8')).toBe('old')
  })

  it('fs.trash sends files and directories to the OS trash', async () => {
    writeFileSync(join(dir, 'doomed.md'), 'bye')
    mkdirSync(join(dir, 'doomed-dir/nested'), { recursive: true })

    const fileResult = await tools.call('fs.trash', { path: 'doomed.md' }, ctx) as { trashed: string }
    const dirResult = await tools.call('fs.trash', { path: 'doomed-dir' }, ctx) as { trashed: string }

    expect(fileResult.trashed).toBe('doomed.md')
    expect(dirResult.trashed).toBe('doomed-dir')
    expect(trashItem).toHaveBeenCalledTimes(2)
    expect(trashItem).toHaveBeenCalledWith(join(dir, 'doomed.md'))
    expect(trashItem).toHaveBeenCalledWith(join(dir, 'doomed-dir'))
  })

  it('fs.trash reports user-initiated trashes so the editor can close clean tabs', async () => {
    writeFileSync(join(dir, 'gone.md'), 'bye')
    mkdirSync(join(dir, 'gone-dir'), { recursive: true })

    await tools.call('fs.trash', { path: 'gone.md' }, ctx)
    await tools.call('fs.trash', { path: 'gone-dir' }, ctx)

    expect(onUserTrashed).toHaveBeenNthCalledWith(1, ['gone.md'])
    expect(onUserTrashed).toHaveBeenNthCalledWith(2, ['gone-dir'])
  })

  it('fs.trash does not report agent-initiated trashes', async () => {
    writeFileSync(join(dir, 'agent-gone.md'), 'bye')

    await tools.call('fs.trash', { path: 'agent-gone.md' }, { actor: 'ai' })

    expect(onUserTrashed).not.toHaveBeenCalled()
  })

  it('fs.trash requires an existing path and an available trash backend', async () => {
    await expect(
      tools.call('fs.trash', { path: 'missing.md' }, ctx)
    ).rejects.toThrow('does not exist')

    const bare = createToolRegistry(createTraceLog())
    bare.setWorkspacePath(dir)
    registerFileTools(bare)
    writeFileSync(join(dir, 'present.md'), 'x')
    await expect(
      bare.call('fs.trash', { path: 'present.md' }, ctx)
    ).rejects.toThrow('not available')
  })

  it('fs.copy duplicates a file to an explicit destination', async () => {
    writeFileSync(join(dir, 'src.md'), 'content')

    const result = await tools.call('fs.copy', {
      path: 'src.md',
      new_path: 'nested/dest.md',
    }, ctx) as { copied: { from: string; to: string } }

    expect(result.copied).toEqual({ from: 'src.md', to: 'nested/dest.md' })
    expect(readFileSync(join(dir, 'nested/dest.md'), 'utf-8')).toBe('content')
    expect(readFileSync(join(dir, 'src.md'), 'utf-8')).toBe('content')
  })

  it('fs.copy without new_path auto-numbers a collision-free copy', async () => {
    writeFileSync(join(dir, 'report.md'), 'v1')
    writeFileSync(join(dir, 'report copy.md'), 'taken')

    const result = await tools.call('fs.copy', { path: 'report.md' }, ctx) as {
      copied: { from: string; to: string }
    }

    expect(result.copied).toEqual({ from: 'report.md', to: 'report copy 2.md' })
    expect(readFileSync(join(dir, 'report copy 2.md'), 'utf-8')).toBe('v1')
  })

  it('fs.copy duplicates directories recursively and refuses to overwrite', async () => {
    mkdirSync(join(dir, 'pack/inner'), { recursive: true })
    writeFileSync(join(dir, 'pack/inner/file.txt'), 'deep')
    writeFileSync(join(dir, 'blocked.md'), 'taken')
    writeFileSync(join(dir, 'one.md'), 'x')

    const result = await tools.call('fs.copy', { path: 'pack' }, ctx) as {
      copied: { from: string; to: string }
    }
    expect(result.copied.to).toBe('pack copy')
    expect(readFileSync(join(dir, 'pack copy/inner/file.txt'), 'utf-8')).toBe('deep')

    await expect(
      tools.call('fs.copy', { path: 'one.md', new_path: 'blocked.md' }, ctx)
    ).rejects.toThrow('Destination already exists')
  })

  it('fs.import copies an external file into a workspace directory', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mim-import-src-'))
    writeFileSync(join(outside, 'report.docx'), 'external doc')
    mkdirSync(join(dir, 'docs'))

    const result = await tools.call('fs.import', {
      source_path: join(outside, 'report.docx'),
      dest_dir: 'docs',
    }, ctx) as { imported: string }

    expect(result.imported).toBe('docs/report.docx')
    expect(readFileSync(join(dir, 'docs/report.docx'), 'utf-8')).toBe('external doc')
    expect(readFileSync(join(outside, 'report.docx'), 'utf-8')).toBe('external doc')
    rmSync(outside, { recursive: true, force: true })
  })

  it('fs.import numbers collisions and copies directories recursively', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mim-import-src-'))
    writeFileSync(join(outside, 'notes.md'), 'incoming')
    writeFileSync(join(dir, 'notes.md'), 'already here')
    mkdirSync(join(outside, 'assets/icons'), { recursive: true })
    writeFileSync(join(outside, 'assets/icons/a.svg'), '<svg/>')

    const file = await tools.call('fs.import', {
      source_path: join(outside, 'notes.md'),
    }, ctx) as { imported: string }
    expect(file.imported).toBe('notes 2.md')
    expect(readFileSync(join(dir, 'notes 2.md'), 'utf-8')).toBe('incoming')
    expect(readFileSync(join(dir, 'notes.md'), 'utf-8')).toBe('already here')

    const folder = await tools.call('fs.import', {
      source_path: join(outside, 'assets'),
    }, ctx) as { imported: string }
    expect(folder.imported).toBe('assets')
    expect(readFileSync(join(dir, 'assets/icons/a.svg'), 'utf-8')).toBe('<svg/>')
    rmSync(outside, { recursive: true, force: true })
  })

  it('fs.import refuses relative sources, missing sources, and sources already inside the workspace', async () => {
    await expect(
      tools.call('fs.import', { source_path: 'relative.md' }, ctx)
    ).rejects.toThrow('absolute')

    await expect(
      tools.call('fs.import', { source_path: join(tmpdir(), 'mim-definitely-missing-xyz.md') }, ctx)
    ).rejects.toThrow('does not exist')

    writeFileSync(join(dir, 'inside.md'), 'x')
    await expect(
      tools.call('fs.import', { source_path: join(dir, 'inside.md') }, ctx)
    ).rejects.toThrow('already inside')
  })

  it('fs.edit replaces one unique match', async () => {
    writeFileSync(join(dir, 'edit.md'), 'alpha beta gamma')

    const result = await tools.call('fs.edit', {
      path: 'edit.md',
      old_text: 'beta',
      new_text: 'BETA',
    }, ctx) as { edited: string }

    expect(result.edited).toBe('edit.md')
    expect(readFileSync(join(dir, 'edit.md'), 'utf-8')).toBe('alpha BETA gamma')
  })

  it('fs.edit tolerates typographic and whitespace variants', async () => {
    writeFileSync(join(dir, 'typography.md'), 'She  said “hello”\r\ntoday.')

    await tools.call('fs.edit', {
      path: 'typography.md',
      old_text: 'She said "hello"\ntoday.',
      new_text: 'She said hello today.',
    }, ctx)

    expect(readFileSync(join(dir, 'typography.md'), 'utf-8')).toBe('She said hello today.')
  })

  it('fs.edit requires exactly one match', async () => {
    writeFileSync(join(dir, 'ambiguous.md'), 'target one\ntarget two')

    await expect(
      tools.call('fs.edit', {
        path: 'ambiguous.md',
        old_text: 'target',
        new_text: 'replacement',
      }, ctx)
    ).rejects.toThrow('matches 2 locations')

    expect(readFileSync(join(dir, 'ambiguous.md'), 'utf-8')).toBe('target one\ntarget two')
  })

  it('rejects sibling-prefix path escapes', async () => {
    const sibling = `${dir}-sibling`
    mkdirSync(sibling)
    writeFileSync(join(sibling, 'secret.txt'), 'secret')

    try {
      await expect(
        tools.call('fs.read', { path: '../' + sibling.split('/').pop() + '/secret.txt' }, ctx)
      ).rejects.toThrow('traversal')
    } finally {
      rmSync(sibling, { recursive: true, force: true })
    }
  })

  it('rejects path traversal', async () => {
    await expect(
      tools.call('fs.read', { path: '../../../etc/passwd' }, ctx)
    ).rejects.toThrow('traversal')
  })

  it('throws when no workspace is open', async () => {
    const noWs = createToolRegistry(createTraceLog())
    registerFileTools(noWs)
    await expect(
      noWs.call('fs.read', { path: 'test.md' }, ctx)
    ).rejects.toThrow('No workspace')
  })

  describe('symlink escape prevention', () => {
    let outsideDir: string

    beforeEach(() => {
      outsideDir = mkdtempSync(join(tmpdir(), 'mim-fs-outside-'))
      writeFileSync(join(outsideDir, 'secret.txt'), 'top-secret')
    })

    afterEach(() => {
      rmSync(outsideDir, { recursive: true, force: true })
    })

    it('rejects fs.write through a symlink pointing outside workspace', async () => {
      symlinkSync(join(outsideDir, 'secret.txt'), join(dir, 'escape.txt'))

      await expect(
        tools.call('fs.write', { path: 'escape.txt', content: 'pwned' }, ctx),
      ).rejects.toThrow('symlink')
      expect(readFileSync(join(outsideDir, 'secret.txt'), 'utf-8')).toBe('top-secret')
    })

    it('rejects fs.read through a symlink pointing outside workspace', async () => {
      symlinkSync(join(outsideDir, 'secret.txt'), join(dir, 'escape.txt'))

      await expect(
        tools.call('fs.read', { path: 'escape.txt' }, ctx),
      ).rejects.toThrow('symlink')
    })

    it('rejects fs.delete through a symlink pointing outside workspace', async () => {
      symlinkSync(join(outsideDir, 'secret.txt'), join(dir, 'escape.txt'))

      await expect(
        tools.call('fs.delete', { path: 'escape.txt' }, ctx),
      ).rejects.toThrow('symlink')
      expect(existsSync(join(outsideDir, 'secret.txt'))).toBe(true)
    })

    it('rejects access through a symlinked directory', async () => {
      symlinkSync(outsideDir, join(dir, 'linked-dir'))

      await expect(
        tools.call('fs.read', { path: 'linked-dir/secret.txt' }, ctx),
      ).rejects.toThrow('symlink')
    })

    it('rejects fs.write through a dangling symlink pointing outside workspace', async () => {
      // The target does not exist yet — a write through the link would CREATE
      // it outside the workspace. existsSync follows symlinks, so a naive
      // existence walk skips the link entirely; the guard must still see it.
      symlinkSync(join(outsideDir, 'not-yet-created.txt'), join(dir, 'dangling.txt'))

      await expect(
        tools.call('fs.write', { path: 'dangling.txt', content: 'pwned' }, ctx),
      ).rejects.toThrow('symlink')
      expect(existsSync(join(outsideDir, 'not-yet-created.txt'))).toBe(false)
    })

    it('allows a dangling symlink whose target is inside the workspace', async () => {
      symlinkSync(join(dir, 'future.txt'), join(dir, 'alias-to-future.txt'))

      await tools.call('fs.write', { path: 'alias-to-future.txt', content: 'ok' }, ctx)
      expect(readFileSync(join(dir, 'future.txt'), 'utf-8')).toBe('ok')
    })

    it('allows symlinks that stay inside the workspace', async () => {
      writeFileSync(join(dir, 'real.txt'), 'safe')
      symlinkSync(join(dir, 'real.txt'), join(dir, 'alias.txt'))

      const result = await tools.call('fs.read', { path: 'alias.txt' }, ctx) as { content: string }
      expect(result.content).toBe('safe')
    })

    it('allows the managed .mim/team checkout symlink', async () => {
      mkdirSync(join(dir, '.mim'), { recursive: true })
      symlinkSync(outsideDir, join(dir, '.mim', 'team'))

      const result = await tools.call('fs.read', {
        path: '.mim/team/secret.txt',
      }, ctx) as { content: string }
      expect(result.content).toBe('top-secret')
    })

    it('allows only the managed Personal and Mim origin mounts', async () => {
      mkdirSync(join(dir, '.mim', 'origins', 'you'), { recursive: true })
      mkdirSync(join(dir, '.mim', 'origins', 'mim'), { recursive: true })
      symlinkSync(outsideDir, join(dir, '.mim', 'origins', 'you', 'skills'))
      symlinkSync(outsideDir, join(dir, '.mim', 'origins', 'mim', 'skills'))

      await expect(tools.call('fs.read', {
        path: '.mim/origins/you/skills/secret.txt',
      }, ctx)).resolves.toMatchObject({ content: 'top-secret' })
      await expect(tools.call('fs.read', {
        path: '.mim/origins/mim/skills/secret.txt',
      }, ctx)).resolves.toMatchObject({ content: 'top-secret' })

      symlinkSync(outsideDir, join(dir, '.mim', 'origins', 'other'))
      await expect(tools.call('fs.read', {
        path: '.mim/origins/other/secret.txt',
      }, ctx)).rejects.toThrow('symlink')
    })
  })

  describe('fs.read full mode', () => {
    it('returns complete content for a file larger than DEFAULT_READ_CHARS when full: true', async () => {
      const bigContent = 'x'.repeat(60_000) // exceeds the 50k default cap
      writeFileSync(join(dir, 'big.md'), bigContent)

      const result = await tools.call('fs.read', { path: 'big.md', full: true }, ctx) as {
        content: string
        truncated: boolean
        total_chars: number
      }

      expect(result.content).toBe(bigContent)
      expect(result.content.length).toBe(60_000)
      expect(result.truncated).toBe(false)
      expect(result.total_chars).toBe(60_000)
    })

    it('returns complete content beyond MAX_READ_CHARS when full: true', async () => {
      const hugeContent = 'y'.repeat(250_000) // exceeds the 200k MAX cap
      writeFileSync(join(dir, 'huge.md'), hugeContent)

      const result = await tools.call('fs.read', { path: 'huge.md', full: true }, ctx) as {
        content: string
        truncated: boolean
        total_chars: number
      }

      expect(result.content).toBe(hugeContent)
      expect(result.content.length).toBe(250_000)
      expect(result.truncated).toBe(false)
      expect(result.total_chars).toBe(250_000)
    })

    it('truncates at DEFAULT_READ_CHARS without full flag', async () => {
      const bigContent = 'z'.repeat(60_000)
      writeFileSync(join(dir, 'capped.md'), bigContent)

      const result = await tools.call('fs.read', { path: 'capped.md' }, ctx) as {
        content: string
        truncated: boolean
        total_chars: number
      }

      expect(result.content.length).toBe(50_000)
      expect(result.truncated).toBe(true)
      expect(result.total_chars).toBe(60_000)
    })
  })

  describe('fs.list with include_last_changed_by', () => {
    it('returns entries even when git is not available', async () => {
      writeFileSync(join(dir, 'a.md'), 'content')
      const result = await tools.call('fs.list', {
        path: '.',
        include_last_changed_by: true,
      }, ctx) as { entries: Array<{ name: string; lastChangedBy?: string }> }
      // Should return the entry (git may or may not be available)
      expect(result.entries.some(e => e.name === 'a.md')).toBe(true)
    })

    it('result shape includes lastChangedBy field', async () => {
      writeFileSync(join(dir, 'b.md'), 'content')
      const result = await tools.call('fs.list', {
        path: '.',
        include_last_changed_by: true,
      }, ctx) as { entries: Array<{ name: string; lastChangedBy?: string }> }
      const entry = result.entries.find(e => e.name === 'b.md')
      expect(entry).toBeDefined()
      // lastChangedBy is either a string or undefined (git may not track this)
      expect(typeof entry!.lastChangedBy === 'string' || entry!.lastChangedBy === undefined).toBe(true)
    })
  })

  describe('author cache', () => {
    it('cache is exposed for testing', async () => {
      const { _authorCache } = await import('@main/tools/fs.js')
      expect(_authorCache).toBeInstanceOf(Map)
    })

    it('serves authors from a fresh cache entry', async () => {
      const { _authorCache } = await import('@main/tools/fs.js')
      writeFileSync(join(dir, 'cached.md'), 'content')
      _authorCache.clear()
      _authorCache.set('.', {
        mtimeMs: Number.MAX_SAFE_INTEGER,
        cachedAt: Date.now(),
        authors: new Map([['cached.md', 'Alice']]),
      })
      const result = await tools.call('fs.list', {
        path: '.',
        include_last_changed_by: true,
      }, ctx) as { entries: Array<{ name: string; lastChangedBy?: string }> }
      expect(result.entries.find(e => e.name === 'cached.md')?.lastChangedBy).toBe('Alice')
    })

    it('expires cache entries after the TTL even when directory mtime is unchanged', async () => {
      // Commits and file edits do not bump the parent directory's mtime, so
      // mtime alone can serve stale authors forever; the TTL bounds that.
      const { _authorCache } = await import('@main/tools/fs.js')
      writeFileSync(join(dir, 'stale.md'), 'content')
      _authorCache.clear()
      _authorCache.set('.', {
        mtimeMs: Number.MAX_SAFE_INTEGER,
        cachedAt: Date.now() - 60_000,
        authors: new Map([['stale.md', 'Alice']]),
      })
      const result = await tools.call('fs.list', {
        path: '.',
        include_last_changed_by: true,
      }, ctx) as { entries: Array<{ name: string; lastChangedBy?: string }> }
      // The temp workspace is not a git repo: a bypassed cache means no author.
      expect(result.entries.find(e => e.name === 'stale.md')?.lastChangedBy).not.toBe('Alice')
    })
  })
})
