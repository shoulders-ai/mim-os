import { describe, expect, it } from 'vitest'
import {
  availableEntries,
  filterByText,
  hasUpdate,
  isManageableApp,
  nonOkRegistries,
  registryDisplayName,
  registryEntryAction,
  visibleEntries,
} from './appsSurfaceLogic.js'
import type { RegistryEntry, RegistryInfo, UpdateInfo } from './appsSurfaceLogic.js'
import type { ResolvedApp } from '../../stores/coreApps.js'

function makeApp(overrides: Partial<ResolvedApp> = {}): ResolvedApp {
  return {
    id: 'test-pkg',
    enabled: false,
    layer: 'default',
    installed: true,
    source: 'workspace',
    shadowed: false,
    needsTrust: false,
    needsInstall: false,
    visible: false,
    folderPresent: false,
    ...overrides,
  }
}

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'pkg-a',
    name: 'Package A',
    version: '1.0.0',
    permissions: {},
    installedVersions: [],
    enabledHere: false,
    permissionMismatch: false,
    registryId: 'default',
    ...overrides,
  }
}

function makeRegistry(overrides: Partial<RegistryInfo> = {}): RegistryInfo {
  return {
    id: 'default',
    kind: 'git',
    location: 'https://example.com',
    origin: 'default',
    status: 'ok',
    diagnostics: [],
    ...overrides,
  }
}

// ---- isManageableApp ----

describe('isManageableApp', () => {
  it('returns true for enabled apps', () => {
    expect(isManageableApp(makeApp({ enabled: true }))).toBe(true)
  })

  it('returns true for workspace-layer apps even if disabled', () => {
    expect(isManageableApp(makeApp({ layer: 'workspace' }))).toBe(true)
  })

  it('returns false for local-layer apps that are no longer enabled', () => {
    expect(isManageableApp(makeApp({ layer: 'local' }))).toBe(false)
  })

  it('returns true for needsTrust apps', () => {
    expect(isManageableApp(makeApp({ needsTrust: true }))).toBe(true)
  })

  it('returns true for needsInstall apps', () => {
    expect(isManageableApp(makeApp({ needsInstall: true }))).toBe(true)
  })

  it('returns false for disabled default-layer external apps', () => {
    expect(isManageableApp(makeApp({ enabled: false, layer: 'default', source: 'workspace' }))).toBe(false)
  })
})

// ---- availableEntries ----

describe('availableEntries', () => {
  it('excludes shadowed entries', () => {
    const entries = [
      makeEntry({ id: 'a' }),
      makeEntry({ id: 'b', shadowed: true }),
    ]
    expect(availableEntries(entries, new Set())).toHaveLength(1)
    expect(availableEntries(entries, new Set())[0].id).toBe('a')
  })

  it('excludes entries already in workspace', () => {
    const entries = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
    expect(availableEntries(entries, new Set(['a']))).toHaveLength(1)
    expect(availableEntries(entries, new Set(['a']))[0].id).toBe('b')
  })

  it('collapses multiple registry versions of the same app to the newest version', () => {
    const entries = [
      makeEntry({ id: 'test-private', version: '0.1.0' }),
      makeEntry({ id: 'test-private', version: '0.2.0' }),
    ]
    const result = availableEntries(entries, new Set())
    expect(result).toHaveLength(1)
    expect(result[0].version).toBe('0.2.0')
  })
})

// ---- registryEntryAction ----

describe('registryEntryAction', () => {
  it('returns add for entries not installed', () => {
    expect(registryEntryAction(makeEntry())).toBe('add')
  })

  it('returns update when installed version differs from registry', () => {
    expect(registryEntryAction(makeEntry({ version: '2.0.0', installedVersions: ['1.0.0'] }))).toBe('update')
  })

  it('returns added when enabled here at current version', () => {
    expect(registryEntryAction(makeEntry({ version: '1.0.0', installedVersions: ['1.0.0'], enabledHere: true }))).toBe('added')
  })

  it('returns add when installed elsewhere but not enabled here', () => {
    expect(registryEntryAction(makeEntry({ version: '1.0.0', installedVersions: ['1.0.0'], enabledHere: false }))).toBe('add')
  })
})

// ---- visibleEntries ----

describe('visibleEntries', () => {
  it('filters out shadowed entries', () => {
    const entries = [
      makeEntry({ id: 'a' }),
      makeEntry({ id: 'b', shadowed: true }),
    ]
    const result = visibleEntries(entries)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })
})

// ---- nonOkRegistries ----

describe('nonOkRegistries', () => {
  it('returns only non-ok registries', () => {
    const regs = [
      makeRegistry({ id: 'ok', status: 'ok' }),
      makeRegistry({ id: 'stale', status: 'stale' }),
      makeRegistry({ id: 'err', status: 'error' }),
    ]
    const result = nonOkRegistries(regs)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.id)).toEqual(['stale', 'err'])
  })
})

// ---- registryDisplayName ----

describe('registryDisplayName', () => {
  it('returns registry name when available', () => {
    const regs = [makeRegistry({ id: 'acme', name: 'Acme Apps' })]
    expect(registryDisplayName(regs, 'acme')).toBe('Acme Apps')
  })

  it('falls back to id when no name', () => {
    const regs = [makeRegistry({ id: 'default' })]
    expect(registryDisplayName(regs, 'default')).toBe('default')
  })

  it('returns id when registry not found', () => {
    expect(registryDisplayName([], 'unknown')).toBe('unknown')
  })
})

// ---- filterByText ----

describe('filterByText', () => {
  const rows = [
    { id: 'board', label: 'Board', description: 'Issues board' },
    { id: 'slides', label: 'Slides', description: 'Presentation tool' },
  ]

  it('returns all rows for empty query', () => {
    expect(filterByText(rows, '')).toHaveLength(2)
  })

  it('filters by label', () => {
    expect(filterByText(rows, 'board')).toHaveLength(1)
  })

  it('filters by description', () => {
    expect(filterByText(rows, 'presentation')).toHaveLength(1)
  })

  it('filters by id', () => {
    expect(filterByText(rows, 'slides')).toHaveLength(1)
  })

  it('is case-insensitive', () => {
    expect(filterByText(rows, 'BOARD')).toHaveLength(1)
  })
})

// ---- hasUpdate ----

describe('hasUpdate', () => {
  const updates: Record<string, UpdateInfo> = {
    'slides': { installed: '1.0.0', latest: '1.1.0', registryId: 'default' },
  }

  it('returns true when update exists', () => {
    expect(hasUpdate(updates, 'slides')).toBe(true)
  })

  it('returns false when no update', () => {
    expect(hasUpdate(updates, 'board')).toBe(false)
  })
})
