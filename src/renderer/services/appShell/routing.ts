import type { SettingsSection } from '../../components/settings/sections.js'
import {
  explicitPackageOpenTarget,
  packageNavigatorTarget,
} from '../workbench/packageViews.js'
import type { LoadedPackage } from './types.js'

export type ShellAction =
  | { type: 'open-draft-chat' }
  | { type: 'open-files' }
  | { type: 'open-monitor' }
  | { type: 'open-terminal' }
  | { type: 'open-archive' }
  | { type: 'open-package-work'; packageId: string; viewId: string }
  | { type: 'open-settings'; section?: SettingsSection }
  | { type: 'new-document' }
  | { type: 'open-file-dialog' }
  | { type: 'export-document' }
  | { type: 'open-shortcuts' }
  | { type: 'open-session'; sessionId: string }
  | { type: 'open-file'; path: string }
  | { type: 'none' }

export function resolveNavigatorSurfaceAction(
  id: string,
  packages: LoadedPackage[],
): ShellAction {
  if (id === '__chat__') return { type: 'open-draft-chat' }
  if (id === '__files__') return { type: 'open-files' }
  if (id === '__activity_trust__') return { type: 'open-monitor' }
  if (id === '__terminal__') return { type: 'open-terminal' }
  if (id === '__archive__') return { type: 'open-archive' }

  const pkg = packages.find(item => item.manifest.id === id)
  if (!pkg) return { type: 'none' }

  const target = packageNavigatorTarget(pkg)
  if (target.pane === 'work') {
    return { type: 'open-package-work', packageId: id, viewId: target.view.id }
  }
  return { type: 'open-settings', section: 'apps' }
}

export function resolvePackageOpenAction(
  id: string,
  packages: LoadedPackage[],
): ShellAction {
  const pkg = packages.find(item => item.manifest.id === id)
  if (!pkg) return { type: 'none' }

  const target = explicitPackageOpenTarget(pkg)
  if (target.pane === 'work') {
    return { type: 'open-package-work', packageId: id, viewId: target.view.id }
  }
  return { type: 'open-settings', section: 'apps' }
}

export function resolvePaletteAction(id: string): ShellAction {
  if (id === 'surface:chat') return { type: 'open-draft-chat' }
  if (id === 'surface:files') return { type: 'open-files' }
  if (id === 'surface:trust') return { type: 'open-monitor' }
  if (id === 'surface:terminal') return { type: 'open-terminal' }
  if (id === 'surface:history') return { type: 'open-archive' }
  if (id === 'action:new-chat') return { type: 'open-draft-chat' }
  if (id === 'action:new-document') return { type: 'new-document' }
  if (id === 'action:open-file') return { type: 'open-file-dialog' }
  if (id === 'action:export-document') return { type: 'export-document' }
  if (id === 'action:settings') return { type: 'open-settings' }
  if (id === 'action:shortcuts') return { type: 'open-shortcuts' }
  if (id.startsWith('session:')) return { type: 'open-session', sessionId: id.slice('session:'.length) }
  if (id.startsWith('file:')) return { type: 'open-file', path: id.slice('file:'.length) }
  return { type: 'none' }
}
