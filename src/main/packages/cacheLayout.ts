import { createHash } from 'crypto'
import { join } from 'path'
import { userHomeDir } from '@main/platform.js'

export const DEFAULT_CACHE_ROOT = join(userHomeDir(), '.mim', 'cache')

export function registryMirrorDir(url: string, cacheRoot?: string): string {
  const root = cacheRoot ?? DEFAULT_CACHE_ROOT
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12)
  return join(root, 'registry', hash, 'repo')
}

export function urlIndexCacheFile(url: string, cacheRoot?: string): string {
  const root = cacheRoot ?? DEFAULT_CACHE_ROOT
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12)
  return join(root, 'registry', hash, 'index.json')
}

export function packageMirrorDir(url: string, cacheRoot?: string): string {
  const root = cacheRoot ?? DEFAULT_CACHE_ROOT
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12)
  return join(root, 'package-mirrors', hash, 'repo')
}
