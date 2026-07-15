// Bundled resources consumed by external CLI processes must resolve to real
// filesystem paths. In packaged Electron builds that means app.asar.unpacked,
// while development and tests read from the repository resources directory.

import { existsSync } from 'fs'
import { isAbsolute, join, normalize, resolve } from 'path'

export interface AgentResourceResolverOptions {
  cwd?: string
  moduleDir?: string
  resourcesPath?: string
}

export function resolveBundledAgentResource(
  resourcePath: string,
  options: AgentResourceResolverOptions = {},
): string | null {
  const normalized = normalize(resourcePath)
  if (isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Bundled agent resource paths must be relative')
  }

  const cwd = options.cwd ?? process.cwd()
  const moduleDir = options.moduleDir ?? import.meta.dirname
  const resourcesPath = options.resourcesPath
    ?? (typeof process.resourcesPath === 'string' ? process.resourcesPath : '')

  const candidates = [
    join(cwd, 'resources', normalized),
    resolve(moduleDir, '../../..', 'resources', normalized),
    resolve(moduleDir, '../..', 'resources', normalized),
    resourcesPath ? join(resourcesPath, 'app.asar.unpacked', 'resources', normalized) : '',
    resourcesPath ? join(resourcesPath, 'resources', normalized) : '',
  ].filter(Boolean)

  for (const candidate of new Set(candidates)) {
    const externalPath = candidate.includes('app.asar') && !candidate.includes('app.asar.unpacked')
      ? candidate.replace('app.asar', 'app.asar.unpacked')
      : candidate
    if (existsSync(externalPath)) return externalPath
  }
  return null
}
