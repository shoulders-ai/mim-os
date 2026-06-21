import { describe, expect, it } from 'vitest'
import {
  defaultWorkPackageView,
  explicitPackageOpenTarget,
  packageNavigatorTarget,
  packageWorkEntryId,
  type PackageWithViews,
} from './packageViews.js'

function pkg(views: PackageWithViews['manifest']['views']): PackageWithViews {
  return {
    manifest: {
      id: 'reviewer',
      views,
    },
  }
}

describe('app view roles', () => {
  it('selects Work-capable views for Navigator/Work entries', () => {
    const item = pkg([
      { id: 'report', label: 'Report', src: './ui/report.html', role: 'artifact' },
      { id: 'launch', label: 'Launch', src: './ui/index.html', role: 'work' },
    ])

    expect(defaultWorkPackageView(item)?.id).toBe('launch')
    expect(packageWorkEntryId(item)).toBe('work:package-view:reviewer:launch')
  })

  it('allows either-role views in Work', () => {
    const item = pkg([
      { id: 'detail', label: 'Detail', src: './ui/detail.html', role: 'either' },
    ])

    expect(defaultWorkPackageView(item)?.id).toBe('detail')
  })

  it('keeps Navigator app selection Work-only', () => {
    const artifactOnly = pkg([
      { id: 'report', label: 'Report', src: './ui/report.html', role: 'artifact' },
    ])
    const workCapable = pkg([
      { id: 'launch', label: 'Launch', src: './ui/index.html', role: 'work' },
    ])

    expect(packageNavigatorTarget(workCapable)).toEqual({
      pane: 'work',
      view: workCapable.manifest.views?.[0],
    })
    expect(packageNavigatorTarget(artifactOnly)).toEqual({ pane: 'settings' })
  })

  it('sends explicit opens for Artifact-only apps to Settings', () => {
    const artifactOnly = pkg([
      { id: 'report', label: 'Report', src: './ui/report.html', role: 'artifact' },
    ])

    expect(explicitPackageOpenTarget(artifactOnly)).toEqual({ pane: 'settings' })
  })
})
