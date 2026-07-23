import type { TeamSource } from '@main/team/teamSource.js'
import type { ToolRegistry } from '@main/tools/registry.js'

export interface TeamToolOptions {
  source: TeamSource
  emit?: (channel: string) => void
}

export function registerTeamTools(tools: ToolRegistry, options: TeamToolOptions): void {
  tools.register({
    name: 'team.status',
    description: 'Read the one Personal Team connection, checkout contract, contribution summary, and Git sync state.',
    inputSchema: objectSchema({}),
    execute: async () => options.source.status(),
  })

  tools.register({
    name: 'team.connect',
    description: 'Connect the one Team Git repository using system Git credentials, clone it, and validate its fixed contract.',
    inputSchema: objectSchema({
      repository: { type: 'string', description: 'Credential-free HTTPS, SSH, or local Git repository location' },
    }, ['repository']),
    execute: async (params) => {
      const repository = requireString(params, 'repository')
      const result = await options.source.connect(repository)
      options.emit?.('team:changed')
      return result
    },
  })

  tools.register({
    name: 'team.open',
    description: 'Resolve the connected Team checkout and its fixed contribution paths.',
    inputSchema: objectSchema({}),
    execute: async () => ({ team: await options.source.open() }),
  })

  tools.register({
    name: 'team.sync',
    description: 'Commit, rebase, and push writable Team changes using the connected repository and system Git credentials.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const result = await options.source.sync()
      options.emit?.('team:changed')
      return result
    },
  })
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`)
  return value.trim()
}
