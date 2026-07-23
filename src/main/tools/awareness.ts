import { execFile } from 'child_process'
import { existsSync, statSync } from 'fs'
import { basename, join } from 'path'
import { promisify } from 'util'
import type { ToolRegistry } from '@main/tools/registry.js'

const execFileAsync = promisify(execFile)

export interface RecentChange {
  id: string
  origin: 'project' | 'team'
  path: string
  name: string
  size: number
  author: string
  changedAt: string
  summary: string
}

interface GitChange {
  commit: string
  path: string
  author: string
  changedAt: string
  summary: string
}

export function registerAwarenessTools(tools: ToolRegistry): void {
  tools.register({
    name: 'awareness.recent',
    description: 'Show fetched Project and Team file changes with authors.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const limit = typeof params.limit === 'number'
        ? Math.max(1, Math.min(500, Math.floor(params.limit)))
        : 100
      const teamRoot = join(workspace, '.mim', 'team')
      const [project, team] = await Promise.all([
        readRepositoryChanges(workspace, 'project', '', limit),
        readRepositoryChanges(teamRoot, 'team', '.mim/team/', limit),
      ])
      const changes = [...project, ...team]
        .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) || a.path.localeCompare(b.path))
        .filter((change, index, all) => all.findIndex(item => item.path === change.path) === index)
        .slice(0, limit)
      return {
        changes,
        available: {
          project: existsSync(join(workspace, '.git')),
          team: existsSync(join(teamRoot, '.git')),
        },
      }
    },
  })
}

async function readRepositoryChanges(
  root: string,
  origin: RecentChange['origin'],
  prefix: string,
  limit: number,
): Promise<RecentChange[]> {
  if (!existsSync(join(root, '.git'))) return []
  let output: string
  try {
    const result = await execFileAsync('git', [
      '-C',
      root,
      'log',
      '-z',
      `--max-count=${Math.min(limit, 100)}`,
      '--date=iso-strict',
      '--no-renames',
      '--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s',
      '--name-only',
    ], {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    })
    output = result.stdout
  } catch {
    return []
  }

  const seen = new Set<string>()
  const changes: RecentChange[] = []
  for (const change of parseGitChanges(output)) {
    if (seen.has(change.path)) continue
    seen.add(change.path)
    const visiblePath = `${prefix}${change.path}`
    const absolutePath = join(root, change.path)
    try {
      const stat = statSync(absolutePath)
      if (!stat.isFile()) continue
      changes.push({
        id: `${origin}:${change.commit}:${change.path}`,
        origin,
        path: visiblePath,
        name: basename(change.path),
        size: stat.size,
        author: change.author,
        changedAt: change.changedAt,
        summary: change.summary,
      })
    } catch {
      // Deleted paths stay in Git history but are not actionable in Files.
    }
  }
  return changes
}

export function parseGitChanges(output: string): GitChange[] {
  const changes: GitChange[] = []
  for (const rawRecord of output.split('\x1e').slice(1)) {
    const newline = rawRecord.indexOf('\n')
    if (newline < 0) continue
    const [commit, author, changedAt, summary] = rawRecord.slice(0, newline).split('\x1f')
    if (!commit || !author || !changedAt) continue
    const paths = rawRecord.slice(newline + 1).split('\0').map(path => path.trim()).filter(Boolean)
    for (const path of paths) {
      changes.push({ commit, path, author, changedAt, summary: summary ?? '' })
    }
  }
  return changes
}
