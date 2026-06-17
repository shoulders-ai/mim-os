import type { FileVersion, TabState } from './editorTypes.js'

export function fileLabel(path: string): string {
  return path.split('/').pop() || path || 'Untitled'
}

export function fileExtensionForTelemetry(path: string): string {
  const name = fileLabel(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : 'none'
}

export function formatNumber(n: number): string {
  return n.toLocaleString()
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return formatNumber(n)
  if (n < 10000) {
    const value = n / 1000
    const rounded = value < 10 ? value.toFixed(1) : value.toFixed(0)
    return `${rounded.replace(/\.0$/, '')}k`
  }
  return `${Math.round(n / 1000).toLocaleString()}k`
}

export function suggestedSavePath(tab: Pick<TabState, 'path' | 'name'>): string {
  if (tab.path) return tab.path
  const name = tab.name.trim() || 'Untitled'
  return /\.[^/\\.]+$/.test(name) ? name : `${name}.md`
}

export function extractFileVersion(result: unknown): FileVersion | undefined {
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  const version = record.version && typeof record.version === 'object'
    ? record.version as Record<string, unknown>
    : undefined
  const hash = typeof version?.hash === 'string'
    ? version.hash
    : typeof record.hash === 'string'
      ? record.hash
      : undefined
  if (!hash) return undefined
  return {
    hash,
    size: typeof version?.size === 'number' ? version.size : undefined,
    mtimeMs: typeof version?.mtimeMs === 'number' ? version.mtimeMs : undefined,
    modifiedAt: typeof version?.modifiedAt === 'string' ? version.modifiedAt : undefined,
  }
}
