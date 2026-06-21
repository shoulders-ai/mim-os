import { describe, expect, it } from 'vitest'
import {
  resolveNavigatorSurfaceAction,
  resolvePackageOpenAction,
  resolvePaletteAction,
} from './routing.js'
import type { LoadedPackage } from './types.js'

const packages: LoadedPackage[] = [
  {
    manifest: {
      id: 'references',
      name: 'References',
      views: [{ id: 'main', label: 'Library', src: 'index.html', role: 'work' }],
    },
    dir: '/pkg/references',
    source: 'registry',
  },
  {
    manifest: {
      id: 'settings-only',
      name: 'Settings only',
      views: [{ id: 'config', label: 'Config', src: 'index.html', role: 'artifact' }],
    },
    dir: '/pkg/settings-only',
    source: 'registry',
  },
]

describe('app shell routing', () => {
  it('routes fixed Navigator destinations to Work actions', () => {
    expect(resolveNavigatorSurfaceAction('__chat__', packages)).toEqual({ type: 'open-draft-chat' })
    expect(resolveNavigatorSurfaceAction('__files__', packages)).toEqual({ type: 'open-files' })
    expect(resolveNavigatorSurfaceAction('__activity_trust__', packages)).toEqual({ type: 'open-monitor' })
    expect(resolveNavigatorSurfaceAction('__terminal__', packages)).toEqual({ type: 'open-terminal' })
    expect(resolveNavigatorSurfaceAction('__archive__', packages)).toEqual({ type: 'open-archive' })
  })

  it('routes apps with Work views to app Work and others to Apps settings', () => {
    expect(resolveNavigatorSurfaceAction('references', packages)).toEqual({
      type: 'open-package-work',
      packageId: 'references',
      viewId: 'main',
    })
    expect(resolveNavigatorSurfaceAction('settings-only', packages)).toEqual({
      type: 'open-settings',
      section: 'apps',
    })
    expect(resolveNavigatorSurfaceAction('missing', packages)).toEqual({ type: 'none' })
  })

  it('uses explicit app-open rules for WorkHost and Settings launches', () => {
    expect(resolvePackageOpenAction('references', packages)).toEqual({
      type: 'open-package-work',
      packageId: 'references',
      viewId: 'main',
    })
    expect(resolvePackageOpenAction('settings-only', packages)).toEqual({
      type: 'open-settings',
      section: 'apps',
    })
    expect(resolvePackageOpenAction('missing', packages)).toEqual({ type: 'none' })
  })

  it('normalizes command palette item ids to shell actions', () => {
    expect(resolvePaletteAction('surface:chat')).toEqual({ type: 'open-draft-chat' })
    expect(resolvePaletteAction('surface:files')).toEqual({ type: 'open-files' })
    expect(resolvePaletteAction('surface:trust')).toEqual({ type: 'open-monitor' })
    expect(resolvePaletteAction('surface:terminal')).toEqual({ type: 'open-terminal' })
    expect(resolvePaletteAction('surface:history')).toEqual({ type: 'open-archive' })
    expect(resolvePaletteAction('action:new-document')).toEqual({ type: 'new-document' })
    expect(resolvePaletteAction('action:open-file')).toEqual({ type: 'open-file-dialog' })
    expect(resolvePaletteAction('action:export-document')).toEqual({ type: 'export-document' })
    expect(resolvePaletteAction('action:settings')).toEqual({ type: 'open-settings' })
    expect(resolvePaletteAction('action:shortcuts')).toEqual({ type: 'open-shortcuts' })
    expect(resolvePaletteAction('session:s1')).toEqual({ type: 'open-session', sessionId: 's1' })
    expect(resolvePaletteAction('file:docs/a.md')).toEqual({ type: 'open-file', path: 'docs/a.md' })
    expect(resolvePaletteAction('unknown')).toEqual({ type: 'none' })
  })
})
