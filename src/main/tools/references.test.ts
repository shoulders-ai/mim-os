import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerReferencesTools } from '@main/tools/references.js'
import { registerSettingsTools } from '@main/tools/settings.js'

describe('references tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-references-test-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerSettingsTools(tools)
    registerReferencesTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is dormant when the default bibliography file is absent', async () => {
    const result = await tools.call('references.readBib', {}, ctx) as {
      exists: boolean
      path: string
      references: unknown[]
      duplicateKeys: unknown[]
    }

    expect(result.exists).toBe(false)
    expect(result.path).toBe('references/references.bib')
    expect(result.references).toEqual([])
    expect(result.duplicateKeys).toEqual([])
  })

  it('parses BibTeX into editor reference rows', async () => {
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'references', 'references.bib'), [
      '@article{smith2020,',
      '  author = {Smith, Jane and Doe, John},',
      '  title = {A Study of Things},',
      '  journal = {Journal of Evidence},',
      '  year = {2020},',
      '  doi = {10.1000/example},',
      '  director = {Nguyen, Linh},',
      '  file = {pdf/smith2020.pdf}',
      '}',
    ].join('\n'))

    const result = await tools.call('references.readBib', {}, ctx) as {
      exists: boolean
      references: Array<Record<string, unknown>>
    }

    expect(result.exists).toBe(true)
    expect(result.references).toEqual([
      expect.objectContaining({
        key: 'smith2020',
        author: 'Smith, Jane; Doe, John',
        year: '2020',
        title: 'A Study of Things',
        source: 'Journal of Evidence',
        journal: 'Journal of Evidence',
        doi: '10.1000/example',
        file: 'pdf/smith2020.pdf',
        fields: expect.objectContaining({
          director: 'Nguyen, Linh',
        }),
      }),
    ])
  })

  it('honors the references.bibPath setting when no path is supplied', async () => {
    mkdirSync(join(dir, 'refs'), { recursive: true })
    writeFileSync(join(dir, 'refs', 'library.bib'), '@book{doe2019, author={Doe, John}, title={A Long Book}, year={2019}}')
    await tools.call('settings.set', { key: 'references.bibPath', value: 'refs/library.bib' }, ctx)

    const result = await tools.call('references.readBib', {}, ctx) as {
      path: string
      references: Array<{ key: string }>
    }

    expect(result.path).toBe('refs/library.bib')
    expect(result.references.map(ref => ref.key)).toEqual(['doe2019'])
  })

  it('reports duplicate keys for editor diagnostics', async () => {
    writeFileSync(join(dir, 'dupes.bib'), [
      '@book{same, title={First}, year={2020}}',
      '@article{same, title={Second}, year={2021}}',
    ].join('\n'))

    const result = await tools.call('references.readBib', { path: 'dupes.bib' }, ctx) as {
      duplicateKeys: Array<{ key: string; count: number }>
    }

    expect(result.duplicateKeys).toEqual([{ key: 'same', count: 2 }])
  })

  it('rejects paths outside the workspace', async () => {
    await expect(tools.call('references.readBib', { path: '../outside.bib' }, ctx))
      .rejects.toThrow(/outside workspace|traversal/i)
  })

  it('sets the active bibliography path through a narrow references tool', async () => {
    mkdirSync(join(dir, 'refs'), { recursive: true })
    writeFileSync(join(dir, 'refs', 'external.bib'), '@book{team2022, title={Shared}, year={2022}}')

    const result = await tools.call('references.setBibliographyPath', {
      path: 'refs/external.bib',
    }, ctx) as { path: string }

    expect(result.path).toBe('refs/external.bib')
    expect(JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8'))['references.bibPath'])
      .toBe('refs/external.bib')

    const read = await tools.call('references.readBib', {}, ctx) as { path: string; references: Array<{ key: string }> }
    expect(read.path).toBe('refs/external.bib')
    expect(read.references.map(ref => ref.key)).toEqual(['team2022'])
  })

  it('sets the active bibliography path to a mounted resource bibliography', async () => {
    const resourceDir = mkdtempSync(join(tmpdir(), 'mim-resource-set-bib-test-'))
    try {
      writeFileSync(join(resourceDir, 'shared.bib'), '@book{team2023, title={Shared Resource}, year={2023}}')
      mkdirSync(join(dir, '.mim', 'resources'), { recursive: true })
      symlinkSync(resourceDir, join(dir, '.mim', 'resources', 'shared'), 'dir')

      const result = await tools.call('references.setBibliographyPath', {
        path: '.mim/resources/shared/shared.bib',
      }, ctx) as { path: string }

      expect(result.path).toBe('.mim/resources/shared/shared.bib')
      expect(JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8'))['references.bibPath'])
        .toBe('.mim/resources/shared/shared.bib')
    } finally {
      rmSync(resourceDir, { recursive: true, force: true })
    }
  })

  it('refuses to set the active bibliography to missing, non-bib, or outside paths', async () => {
    writeFileSync(join(dir, 'notes.txt'), 'not bib')

    await expect(tools.call('references.setBibliographyPath', { path: 'missing.bib' }, ctx))
      .rejects.toThrow('does not exist')
    await expect(tools.call('references.setBibliographyPath', { path: 'notes.txt' }, ctx))
      .rejects.toThrow('Expected a .bib file')
    await expect(tools.call('references.setBibliographyPath', { path: '../outside.bib' }, ctx))
      .rejects.toThrow(/outside workspace|traversal/i)
  })

  it('rejects non-resource symlinks that resolve outside the workspace', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mim-outside-bib-test-'))
    try {
      writeFileSync(join(outside, 'outside.bib'), '@book{outside2024, title={Outside}, year={2024}}')
      symlinkSync(outside, join(dir, 'linked'), 'dir')

      await expect(tools.call('references.readBib', { path: 'linked/outside.bib' }, ctx))
        .rejects.toThrow(/symlink|outside workspace/i)
      await expect(tools.call('references.setBibliographyPath', { path: 'linked/outside.bib' }, ctx))
        .rejects.toThrow(/symlink|outside workspace/i)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('auto-picks the first priority bibliography once and persists it', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'paper.bib'), '@book{doe2019, title={Paper Local}, year={2019}}')

    const result = await tools.call('references.resolveBibliography', {
      path: 'docs/paper.md',
      markdown: 'See [@doe2019].',
    }, ctx) as {
      path: string
      source: string
      citations: number
      unresolved_citations: string[]
      auto_persisted: boolean
    }

    expect(result.path).toBe('docs/paper.bib')
    expect(result.source).toBe('document')
    expect(result.citations).toBe(1)
    expect(result.unresolved_citations).toEqual([])
    expect(result.auto_persisted).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8'))['references.bibPath'])
      .toBe('docs/paper.bib')
  })

  it('sticks with the saved bibliography while it exists', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'paper.bib'), '@book{doe2019, title={Paper Local}, year={2019}}')
    writeFileSync(join(dir, 'references', 'references.bib'), '@book{smith2020, title={Project Library}, year={2020}}')
    await tools.call('settings.set', { key: 'references.bibPath', value: 'docs/paper.bib' }, ctx)

    const result = await tools.call('references.resolveBibliography', {
      path: 'docs/paper.md',
      markdown: 'See [@smith2020].',
    }, ctx) as {
      path: string
      source: string
      unresolved_citations: string[]
    }

    expect(result.path).toBe('docs/paper.bib')
    expect(result.source).toBe('saved')
    expect(result.unresolved_citations).toEqual(['smith2020'])
  })

  it('recovers from a missing saved bibliography by picking the default project library', async () => {
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'references', 'references.bib'), '@book{smith2020, title={Project Library}, year={2020}}')
    await tools.call('settings.set', { key: 'references.bibPath', value: 'missing.bib' }, ctx)

    const result = await tools.call('references.resolveBibliography', {
      markdown: 'See [@smith2020].',
    }, ctx) as {
      path: string
      source: string
      auto_persisted: boolean
    }

    expect(result.path).toBe('references/references.bib')
    expect(result.source).toBe('default')
    expect(result.auto_persisted).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8'))['references.bibPath'])
      .toBe('references/references.bib')
  })

  it('discovers bibliographies in mounted resource collections', async () => {
    const resourceDir = mkdtempSync(join(tmpdir(), 'mim-resource-bib-test-'))
    try {
      writeFileSync(join(resourceDir, 'shared.bib'), '@book{team2021, title={Team Library}, year={2021}}')
      mkdirSync(join(dir, '.mim', 'resources'), { recursive: true })
      symlinkSync(resourceDir, join(dir, '.mim', 'resources', 'shared'), 'dir')

      const result = await tools.call('references.resolveBibliography', {
        markdown: 'See [@team2021].',
      }, ctx) as {
        path: string
        source: string
        citations: number
        unresolved_citations: string[]
      }

      expect(result.path).toBe('.mim/resources/shared/shared.bib')
      expect(result.source).toBe('resource')
      expect(result.citations).toBe(1)
      expect(result.unresolved_citations).toEqual([])
    } finally {
      rmSync(resourceDir, { recursive: true, force: true })
    }
  })

  it('honors frontmatter bibliography without rewriting the saved project setting', async () => {
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'paper.bib'), '@book{doe2019, title={Paper Local}, year={2019}}')
    writeFileSync(join(dir, 'saved.bib'), '@book{smith2020, title={Saved}, year={2020}}')
    await tools.call('settings.set', { key: 'references.bibPath', value: 'saved.bib' }, ctx)

    const result = await tools.call('references.resolveBibliography', {
      path: 'docs/paper.md',
      markdown: '---\nbibliography: docs/paper.bib\n---\n\nSee [@doe2019].',
    }, ctx) as {
      path: string
      source: string
      auto_persisted: boolean
    }

    expect(result.path).toBe('docs/paper.bib')
    expect(result.source).toBe('frontmatter')
    expect(result.auto_persisted).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8'))['references.bibPath'])
      .toBe('saved.bib')
  })
})
