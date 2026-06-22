import { describe, it, expect } from 'vitest'
import { parseRegistryIndex, type RegistryEntry, type RegistryIndex, type ParseRegistryIndexOptions } from '@main/packages/registryIndex.js'

function validEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    id: 'github-monitor',
    name: 'GitHub Monitor',
    description: 'Org-wide issues/PRs/activity monitoring',
    repo: 'https://github.com/shoulders-ai/mim-github-monitor',
    version: '1.2.0',
    ref: 'v1.2.0',
    commit: 'a'.repeat(40),
    permissions: { http: ['api.github.com'], secrets: ['github_token'] },
    engines: { mim: 'runtime-v1' },
    ...overrides,
  }
}

function validIndex(packages?: RegistryEntry[]): unknown {
  return {
    manifestVersion: 1,
    packages: packages ?? [validEntry()],
  }
}

describe('parseRegistryIndex', () => {
  it('accepts a valid index with one entry', () => {
    const result = parseRegistryIndex(validIndex())
    expect(result.entries).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(0)
    expect(result.entries[0]).toMatchObject({
      id: 'github-monitor',
      name: 'GitHub Monitor',
      repo: 'https://github.com/shoulders-ai/mim-github-monitor',
      version: '1.2.0',
      ref: 'v1.2.0',
      commit: 'a'.repeat(40),
    })
  })

  it('accepts an index with multiple valid entries', () => {
    const entries = [
      validEntry(),
      validEntry({ id: 'docx-review', name: 'DOCX Review', repo: 'https://github.com/shoulders-ai/mim-docx-review', version: '0.5.0', ref: 'v0.5.0', commit: 'b'.repeat(40) }),
    ]
    const result = parseRegistryIndex(validIndex(entries))
    expect(result.entries).toHaveLength(2)
    expect(result.diagnostics).toHaveLength(0)
  })

  it('accepts an entry with a monorepo path and passes it through', () => {
    const result = parseRegistryIndex(validIndex([
      validEntry({ repo: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/github-monitor' }),
    ]))
    expect(result.diagnostics).toHaveLength(0)
    expect(result.entries[0].path).toBe('packages/github-monitor')
  })

  it('rejects entries with traversal or absolute paths', () => {
    for (const path of ['../escape', 'packages/../../up', '/abs', 'a//b', '.git/hooks']) {
      const result = parseRegistryIndex(validIndex([validEntry({ path })]))
      expect(result.entries).toHaveLength(0)
      expect(result.diagnostics).toContainEqual(expect.stringContaining('invalid path'))
    }
  })

  it('returns a diagnostic for missing manifestVersion', () => {
    const result = parseRegistryIndex({ packages: [validEntry()] })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('manifestVersion'))
  })

  it('returns a diagnostic for wrong manifestVersion', () => {
    const result = parseRegistryIndex({ manifestVersion: 2, packages: [validEntry()] })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('manifestVersion'))
  })

  it('returns a diagnostic when packages is not an array', () => {
    const result = parseRegistryIndex({ manifestVersion: 1, packages: 'nope' })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('returns a diagnostic when the raw value is not an object', () => {
    const result = parseRegistryIndex('not an object')
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('returns a diagnostic when the raw value is null', () => {
    const result = parseRegistryIndex(null)
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('entry field validation', () => {
  it('rejects an entry missing id', () => {
    const entry = validEntry()
    delete (entry as Record<string, unknown>).id
    const result = parseRegistryIndex(validIndex([entry]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('id'))
  })

  it('rejects an entry with an invalid id', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ id: 'CAPS-BAD' })]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('id'))
  })

  it('rejects an entry missing name', () => {
    const entry = validEntry()
    delete (entry as Record<string, unknown>).name
    const result = parseRegistryIndex(validIndex([entry]))
    expect(result.entries).toHaveLength(0)
  })

  it('rejects an entry with invalid version', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ version: 'not-semver' })]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('version'))
  })

  it('rejects an entry with invalid commit (not 40-hex)', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ commit: 'short' })]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('commit'))
  })

  it('rejects an entry missing ref', () => {
    const entry = validEntry()
    delete (entry as Record<string, unknown>).ref
    const result = parseRegistryIndex(validIndex([entry]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('ref'))
  })

  it('rejects an entry missing repo', () => {
    const entry = validEntry()
    delete (entry as Record<string, unknown>).repo
    const result = parseRegistryIndex(validIndex([entry]))
    expect(result.entries).toHaveLength(0)
  })

  it('skips bad entries but keeps valid ones', () => {
    const good = validEntry()
    const bad = validEntry({ id: 'BAD', version: 'nope' })
    const result = parseRegistryIndex(validIndex([good, bad]))
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].id).toBe('github-monitor')
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('non-HTTPS repo URL refusal', () => {
  it('rejects an entry with an SSH repo URL naming the entry', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ repo: 'git@github.com:shoulders-ai/mim-github-monitor' })]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(
      expect.stringMatching(/HTTPS.*github-monitor|github-monitor.*HTTPS/),
    )
  })

  it('rejects an entry with an HTTP (non-S) repo URL', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ repo: 'http://github.com/shoulders-ai/mim-github-monitor' })]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(
      expect.stringContaining('HTTPS'),
    )
  })

  it('rejects an entry with a file:// repo URL', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ repo: 'file:///tmp/local-repo' })]))
    expect(result.entries).toHaveLength(0)
  })

  it('accepts an HTTPS repo URL', () => {
    const result = parseRegistryIndex(validIndex([validEntry()]))
    expect(result.entries).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(0)
  })
})

function validDirEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'mytool',
    name: 'My Tool',
    version: '0.1.0',
    dir: 'packages/mytool',
    permissions: { http: ['example.com'] },
    engines: { mim: 'runtime-v1' },
    ...overrides,
  }
}

function dirIndex(packages?: Record<string, unknown>[]): unknown {
  return {
    manifestVersion: 1,
    packages: packages ?? [validDirEntry()],
  }
}

describe('local dir entries', () => {
  it('accepts a dir entry with allowLocalDirs', () => {
    const result = parseRegistryIndex(dirIndex(), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(0)
    expect(result.entries[0]).toMatchObject({
      id: 'mytool',
      name: 'My Tool',
      version: '0.1.0',
      dir: 'packages/mytool',
    })
    expect(result.entries[0].repo).toBeUndefined()
    expect(result.entries[0].ref).toBeUndefined()
    expect(result.entries[0].commit).toBeUndefined()
  })

  it('drops a dir entry with diagnostic when allowLocalDirs is false (default)', () => {
    const result = parseRegistryIndex(dirIndex())
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(
      expect.stringContaining('local dir entries are not allowed'),
    )
  })

  it('drops a dir entry with diagnostic when allowLocalDirs is explicitly false', () => {
    const result = parseRegistryIndex(dirIndex(), { allowLocalDirs: false })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(
      expect.stringContaining('local dir entries are not allowed'),
    )
  })

  it('drops an entry with both repo and dir', () => {
    const conflict = validDirEntry({
      repo: 'https://github.com/acme/tool',
      ref: 'v0.1.0',
      commit: 'a'.repeat(40),
    })
    const result = parseRegistryIndex(dirIndex([conflict]), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(
      expect.stringContaining('ambiguous'),
    )
  })

  it('drops dir entries with traversal paths', () => {
    for (const dir of ['../escape', 'packages/../../up', '/abs', '.hidden/tool', '.git/hooks']) {
      const result = parseRegistryIndex(dirIndex([validDirEntry({ dir })]), { allowLocalDirs: true })
      expect(result.entries).toHaveLength(0)
      expect(result.diagnostics).toContainEqual(expect.stringContaining('invalid dir'))
    }
  })

  it('accepts dir: "." for an app at the source root', () => {
    const result = parseRegistryIndex(dirIndex([validDirEntry({ dir: '.' })]), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].dir).toBe('.')
    expect(result.diagnostics).toHaveLength(0)
  })

  it('drops a dir entry missing version', () => {
    const entry = validDirEntry()
    delete entry.version
    const result = parseRegistryIndex(dirIndex([entry]), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('version'))
  })

  it('drops a dir entry with missing permissions (defaults to empty object)', () => {
    const entry = validDirEntry()
    delete entry.permissions
    const result = parseRegistryIndex(dirIndex([entry]), { allowLocalDirs: true })
    // permissions default to {} when missing, so the entry should still be accepted
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].permissions).toEqual({})
  })

  it('drops a dir entry missing name', () => {
    const entry = validDirEntry()
    delete entry.name
    const result = parseRegistryIndex(dirIndex([entry]), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('missing name'))
  })

  it('drops a dir entry missing id', () => {
    const entry = validDirEntry()
    delete entry.id
    const result = parseRegistryIndex(dirIndex([entry]), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('id'))
  })

  it('keeps valid git entries alongside dropped dir entries', () => {
    const gitEntry = validEntry()
    const dirEntry = validDirEntry()
    const result = parseRegistryIndex(
      { manifestVersion: 1, packages: [gitEntry, dirEntry] },
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].id).toBe('github-monitor')
    expect(result.diagnostics).toContainEqual(
      expect.stringContaining('local dir entries are not allowed'),
    )
  })
})

// ---------------------------------------------------------------------------
// archive entries
// ---------------------------------------------------------------------------

function validArchiveEntry(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'slides',
    name: 'Slides',
    version: '2.0.0',
    archive: 'https://mim.shoulde.rs/api/v1/packages/slides/2.0.0.tar.gz',
    hash: 'sha256:' + 'ab'.repeat(32),
    permissions: { http: ['example.com'] },
    ...overrides,
  }
}

function archiveIndex(packages?: Record<string, unknown>[]): unknown {
  return {
    manifestVersion: 1,
    packages: packages ?? [validArchiveEntry()],
  }
}

describe('archive entries', () => {
  it('accepts a valid archive entry with HTTPS URL and sha256 hash', () => {
    const result = parseRegistryIndex(archiveIndex())
    expect(result.entries).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(0)
    expect(result.entries[0]).toMatchObject({
      id: 'slides',
      name: 'Slides',
      version: '2.0.0',
      archive: 'https://mim.shoulde.rs/api/v1/packages/slides/2.0.0.tar.gz',
      hash: 'sha256:' + 'ab'.repeat(32),
    })
    expect(result.entries[0].repo).toBeUndefined()
    expect(result.entries[0].dir).toBeUndefined()
    expect(result.entries[0].ref).toBeUndefined()
    expect(result.entries[0].commit).toBeUndefined()
  })

  it('rejects an archive entry with non-HTTPS URL', () => {
    const result = parseRegistryIndex(archiveIndex([
      validArchiveEntry({ archive: 'http://example.com/pkg.tar.gz' }),
    ]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('HTTPS'))
  })

  it('rejects an archive entry with invalid hash format', () => {
    const result = parseRegistryIndex(archiveIndex([
      validArchiveEntry({ hash: 'md5:abc123' }),
    ]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('hash'))
  })

  it('rejects an archive entry with missing hash', () => {
    const entry = validArchiveEntry()
    delete entry.hash
    const result = parseRegistryIndex(archiveIndex([entry]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('hash'))
  })

  it('rejects an entry with both archive and repo', () => {
    const result = parseRegistryIndex(archiveIndex([
      validArchiveEntry({
        repo: 'https://github.com/acme/tool',
        ref: 'v1.0.0',
        commit: 'a'.repeat(40),
      }),
    ]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('ambiguous'))
  })

  it('rejects an entry with both archive and dir', () => {
    const result = parseRegistryIndex(archiveIndex([
      validArchiveEntry({ dir: 'packages/slides' }),
    ]), { allowLocalDirs: true })
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('ambiguous'))
  })

  it('does not require ref or commit for archive entries', () => {
    const entry = validArchiveEntry()
    // Explicitly ensure ref and commit are absent
    delete entry.ref
    delete entry.commit
    const result = parseRegistryIndex(archiveIndex([entry]))
    expect(result.entries).toHaveLength(1)
    expect(result.diagnostics).toHaveLength(0)
  })

  it('still requires id, name, version, permissions for archive entries', () => {
    const noId = validArchiveEntry()
    delete noId.id
    expect(parseRegistryIndex(archiveIndex([noId])).entries).toHaveLength(0)

    const noName = validArchiveEntry()
    delete noName.name
    expect(parseRegistryIndex(archiveIndex([noName])).entries).toHaveLength(0)

    const noVersion = validArchiveEntry()
    delete noVersion.version
    expect(parseRegistryIndex(archiveIndex([noVersion])).entries).toHaveLength(0)
  })

  it('rejects an archive entry with a hash that has wrong length', () => {
    const result = parseRegistryIndex(archiveIndex([
      validArchiveEntry({ hash: 'sha256:abcd' }),
    ]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('hash'))
  })

  it('rejects an archive entry with uppercase hex in hash', () => {
    const result = parseRegistryIndex(archiveIndex([
      validArchiveEntry({ hash: 'sha256:' + 'AB'.repeat(32) }),
    ]))
    expect(result.entries).toHaveLength(0)
    expect(result.diagnostics).toContainEqual(expect.stringContaining('hash'))
  })
})

describe('permissions and engines passthrough', () => {
  it('passes through permissions and engines from a valid entry', () => {
    const result = parseRegistryIndex(validIndex())
    expect(result.entries[0].permissions).toEqual({ http: ['api.github.com'], secrets: ['github_token'] })
    expect(result.entries[0].engines).toEqual({ mim: 'runtime-v1' })
  })

  it('accepts an entry with empty permissions', () => {
    const result = parseRegistryIndex(validIndex([validEntry({ permissions: {} })]))
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].permissions).toEqual({})
  })

  it('accepts an entry with no engines', () => {
    const entry = validEntry()
    delete (entry as Record<string, unknown>).engines
    const result = parseRegistryIndex(validIndex([entry]))
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].engines).toBeUndefined()
  })
})
