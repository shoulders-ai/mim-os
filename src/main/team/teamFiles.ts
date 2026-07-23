// A workspace gets one stable view of the connected Team checkout. The mount
// covers the checkout so later Team contributions share the same provenance;
// the Files UI and search expose only its writable files/ directory.

import {
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'fs'
import { dirname, join, resolve } from 'path'
import type { TeamCheckout } from '@main/team/teamSource.js'

export interface TeamFilesMountResult {
  mounted: boolean
  removed: boolean
  conflict: boolean
}

export function teamMountPath(workspaceDir: string): string {
  return join(workspaceDir, '.mim', 'team')
}

export function teamFilesMountPath(workspaceDir: string): string {
  return join(teamMountPath(workspaceDir), 'files')
}

export function teamMountSymlinkType(
  platform: NodeJS.Platform = process.platform,
): 'dir' | 'junction' {
  return platform === 'win32' ? 'junction' : 'dir'
}

export function syncTeamFilesMount(
  workspaceDir: string,
  team: TeamCheckout | null,
): TeamFilesMountResult {
  const mount = teamMountPath(workspaceDir)
  const existing = safeLstat(mount)

  if (!team) {
    if (!existing) return { mounted: false, removed: false, conflict: false }
    if (!existing.isSymbolicLink()) {
      return { mounted: false, removed: false, conflict: true }
    }
    rmSync(mount, { force: true })
    return { mounted: false, removed: true, conflict: false }
  }

  if (existing) {
    if (!existing.isSymbolicLink()) {
      return { mounted: false, removed: false, conflict: true }
    }
    const currentTarget = resolve(dirname(mount), readlinkSync(mount))
    if (currentTarget === resolve(team.root)) {
      return { mounted: true, removed: false, conflict: false }
    }
    rmSync(mount, { force: true })
  }

  mkdirSync(dirname(mount), { recursive: true })
  symlinkSync(team.root, mount, teamMountSymlinkType())
  return { mounted: true, removed: false, conflict: false }
}

function safeLstat(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
