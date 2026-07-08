import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { isValidPackageId } from '@main/packages/packageManifest.js'

export interface MigrateServeStructuredStateOptions {
  sourceWorkspacePath: string
  targetWorkspacePath: string
  packageIds?: string[]
}

export interface MigrateServeStructuredStateResult {
  migrated: string[]
  skipped: string[]
}

const DEFAULT_STATE_PACKAGES = ['board', 'knowledge', 'references']

export function migrateServeStructuredState(
  options: MigrateServeStructuredStateOptions,
): MigrateServeStructuredStateResult {
  const migrated: string[] = []
  const skipped: string[] = []
  const sourceWorkspace = resolve(options.sourceWorkspacePath)
  const targetWorkspace = resolve(options.targetWorkspacePath)
  const packageIds = options.packageIds ?? DEFAULT_STATE_PACKAGES

  for (const packageId of packageIds) {
    if (!isValidPackageId(packageId)) throw new Error(`Invalid package id: ${packageId}`)
    const source = appDataDir(sourceWorkspace, packageId)
    const target = appDataDir(targetWorkspace, packageId)
    if (!existsSync(source)) {
      skipped.push(packageId)
      continue
    }
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, force: true, errorOnExist: false })
    migrated.push(packageId)
  }

  return { migrated, skipped }
}

function appDataDir(workspacePath: string, packageId: string): string {
  return join(workspacePath, '.mim', 'packages', packageId, 'data')
}
