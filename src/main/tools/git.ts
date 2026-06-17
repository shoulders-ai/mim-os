import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import type { ToolRegistry } from '@main/tools/registry.js'

const execFileAsync = promisify(execFile)

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireWorkspace(tools: ToolRegistry): string {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  return workspace
}

async function git(workspace: string, args: string[]): Promise<string> {
  if (!existsSync(join(workspace, '.git'))) throw new Error('Workspace is not a git repository')
  const { stdout } = await execFileAsync('git', ['-C', workspace, ...args], {
    timeout: 120000,
    maxBuffer: 5 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

export function registerGitTools(tools: ToolRegistry): void {
  tools.register({
    name: 'git.status',
    description: 'Read concise git status for the current workspace.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const workspace = requireWorkspace(tools)
      const output = await git(workspace, ['status', '--short', '--branch'])
      return { status: output, clean: !output.split('\n').slice(1).some(Boolean) }
    },
  })

  tools.register({
    name: 'git.diff',
    description: 'Read git diff for the current workspace or one path.',
    inputSchema: objectSchema({ path: { type: 'string' }, staged: { type: 'boolean' } }),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const args = ['diff']
      if (params.staged === true) args.push('--staged')
      const path = optionalString(params, 'path')
      if (path) args.push('--', path)
      return { diff: await git(workspace, args) }
    },
  })

  tools.register({
    name: 'git.log',
    description: 'Read recent git commits for the current workspace.',
    inputSchema: objectSchema({ limit: { type: 'number' } }),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const limit = typeof params.limit === 'number'
        ? Math.max(1, Math.min(50, Math.floor(params.limit)))
        : 20
      return {
        log: await git(workspace, ['log', `--max-count=${limit}`, '--date=iso', '--pretty=format:%h%x09%ad%x09%s']),
      }
    },
  })

  tools.register({
    name: 'git.commit',
    description: 'Stage all workspace changes and create a git commit.',
    inputSchema: objectSchema({ message: { type: 'string' } }, ['message']),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const message = optionalString(params, 'message')
      if (!message) throw new Error('message is required')
      await git(workspace, ['add', '-A'])
      const output = await git(workspace, ['commit', '-m', message])
      return { committed: true, output }
    },
  })

  tools.register({
    name: 'git.pull',
    description: 'Pull from the current git remote using --ff-only.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const workspace = requireWorkspace(tools)
      return { pulled: true, output: await git(workspace, ['pull', '--ff-only']) }
    },
  })

  tools.register({
    name: 'git.push',
    description: 'Push the current branch to its configured upstream.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const workspace = requireWorkspace(tools)
      return { pushed: true, output: await git(workspace, ['push']) }
    },
  })
}
