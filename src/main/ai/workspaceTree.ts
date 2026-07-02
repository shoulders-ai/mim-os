import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from 'fs'
import { join } from 'path'

export const WORKSPACE_TREE_ROOT_LIMIT = 50
export const WORKSPACE_TREE_CHILD_LIMIT = 10

const HIDDEN_CONTENT_DIRS = new Set([
  '.git',
  '.mim',
  'knowledge',
  'issues',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.next',
  '.nuxt',
  '__pycache__',
  'target',
  '.venv',
  'venv',
  '.env',
])

type EntryKind = 'dir' | 'file' | 'symlink-dir' | 'symlink-file' | 'other'

interface TreeEntry {
  name: string
  fullPath: string
  kind: EntryKind
  target?: string
}

export function renderWorkspaceTree(workspacePath?: string | null): string {
  const lines = ['# Workspace tree', '']
  if (!workspacePath || !existsSync(workspacePath)) {
    lines.push('No workspace tree available.')
    return lines.join('\n')
  }

  lines.push(workspacePath)
  try {
    const rootEntries = readEntries(workspacePath)
    appendRootEntries(lines, rootEntries)
  } catch {
    lines.push('`-- Unable to read workspace tree')
  }
  return lines.join('\n')
}

function appendRootEntries(lines: string[], entries: TreeEntry[]): void {
  const visible = entries.slice(0, WORKSPACE_TREE_ROOT_LIMIT)
  const omitted = entries.length - visible.length
  const totalRows = visible.length + (omitted > 0 ? 1 : 0)

  visible.forEach((entry, index) => {
    const isLast = index === totalRows - 1
    appendRootEntry(lines, entry, isLast)
  })

  if (omitted > 0) {
    lines.push(`${connector(true)}... ${omitted} more root entries omitted`)
  }
}

function appendRootEntry(lines: string[], entry: TreeEntry, isLast: boolean): void {
  lines.push(`${connector(isLast)}${entryLabel(entry)}`)
  if (!shouldExpandRootEntry(entry)) return

  const childPrefix = isLast ? '    ' : '|   '
  appendChildEntries(lines, entry.fullPath, childPrefix)
}

function appendChildEntries(lines: string[], dirPath: string, prefix: string): void {
  let entries: TreeEntry[] = []
  try {
    entries = readEntries(dirPath)
  } catch {
    lines.push(`${prefix}\`-- Unable to read`)
    return
  }

  const visible = entries.slice(0, WORKSPACE_TREE_CHILD_LIMIT)
  const omitted = entries.length - visible.length
  const totalRows = visible.length + (omitted > 0 ? 1 : 0)

  visible.forEach((entry, index) => {
    const isLast = index === totalRows - 1
    lines.push(`${prefix}${connector(isLast)}${entryLabel(entry)}`)
  })

  if (omitted > 0) {
    lines.push(`${prefix}${connector(true)}... ${omitted} more entries omitted`)
  }
}

function shouldExpandRootEntry(entry: TreeEntry): boolean {
  if (HIDDEN_CONTENT_DIRS.has(entry.name)) return false
  return entry.kind === 'dir' || entry.kind === 'symlink-dir'
}

function entryLabel(entry: TreeEntry): string {
  const hidden = HIDDEN_CONTENT_DIRS.has(entry.name)
  if (entry.kind === 'dir') return `${entry.name}/${hidden ? ' [contents hidden]' : ''}`.trimEnd()
  if (entry.kind === 'symlink-dir') {
    return `${entry.name}@ -> ${entry.target ?? 'unknown'}/${hidden ? ' [contents hidden]' : ''}`.trimEnd()
  }
  if (entry.kind === 'symlink-file') return `${entry.name}@ -> ${entry.target ?? 'unknown'}`
  return entry.name
}

function connector(isLast: boolean): string {
  return isLast ? '`-- ' : '|-- '
}

function readEntries(dirPath: string): TreeEntry[] {
  return readdirSync(dirPath, { withFileTypes: true })
    .map(dirent => readEntry(dirPath, dirent.name))
    .filter((entry): entry is TreeEntry => entry !== null)
    .sort(compareEntries)
}

function readEntry(parentPath: string, name: string): TreeEntry | null {
  const fullPath = join(parentPath, name)
  try {
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(fullPath)
      try {
        const targetStat = statSync(fullPath)
        return {
          name,
          fullPath,
          kind: targetStat.isDirectory() ? 'symlink-dir' : 'symlink-file',
          target,
        }
      } catch {
        return { name, fullPath, kind: 'symlink-file', target }
      }
    }
    if (stat.isDirectory()) return { name, fullPath, kind: 'dir' }
    if (stat.isFile()) return { name, fullPath, kind: 'file' }
    return { name, fullPath, kind: 'other' }
  } catch {
    return null
  }
}

function compareEntries(a: TreeEntry, b: TreeEntry): number {
  const group = (entry: TreeEntry) => (
    entry.kind === 'dir' || entry.kind === 'symlink-dir' ? 0 : 1
  )
  const groupDiff = group(a) - group(b)
  if (groupDiff !== 0) return groupDiff
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}
