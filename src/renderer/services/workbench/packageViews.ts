export type PackageViewRole = 'work' | 'artifact' | 'either'

export interface PackageViewDefinition {
  id: string
  label: string
  src: string
  role: PackageViewRole
}

export interface PackageWithViews {
  manifest: {
    id: string
    views?: PackageViewDefinition[]
  }
}

export type PackageNavigatorTarget =
  | { pane: 'work'; view: PackageViewDefinition }
  | { pane: 'settings' }

export type PackageOpenTarget =
  | { pane: 'work'; view: PackageViewDefinition }
  | { pane: 'settings' }

export function isWorkPackageView(view: PackageViewDefinition): boolean {
  return view.role === 'work' || view.role === 'either'
}

export function defaultWorkPackageView(pkg: PackageWithViews): PackageViewDefinition | null {
  return pkg.manifest.views?.find(isWorkPackageView) ?? null
}

export function packageWorkEntryId(pkg: PackageWithViews): string | null {
  const view = defaultWorkPackageView(pkg)
  return view ? `work:package-view:${pkg.manifest.id}:${view.id}` : null
}

export function packageNavigatorTarget(pkg: PackageWithViews): PackageNavigatorTarget {
  const view = defaultWorkPackageView(pkg)
  return view ? { pane: 'work', view } : { pane: 'settings' }
}

export function explicitPackageOpenTarget(pkg: PackageWithViews): PackageOpenTarget {
  const workView = defaultWorkPackageView(pkg)
  if (workView) return { pane: 'work', view: workView }

  return { pane: 'settings' }
}
