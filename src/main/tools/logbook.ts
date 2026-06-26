import { appendLogEntry, readLogbook, type LogbookDeps } from '@main/logbook.js'
import type { ToolRegistry } from '@main/tools/registry.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerLogbookTools(tools: ToolRegistry, deps: LogbookDeps = {}): void {
  tools.register({
    name: 'log.append',
    description: 'Append a short durable activity note to .mim/log.md.',
    inputSchema: objectSchema({ message: { type: 'string' } }, ['message']),
    execute: async (params, ctx) => {
      const path = tools.getWorkspacePath()
      if (!path) throw new Error('No workspace open')
      return appendLogEntry(path, {
        actor: ctx.actor,
        package_id: ctx.package_id,
        sessionId: ctx.sessionId,
        message: typeof params.message === 'string' ? params.message : '',
      }, deps)
    },
  })

  tools.register({
    name: 'log.read',
    description: 'Read the optional human-readable activity logbook from .mim/log.md.',
    inputSchema: objectSchema({ max_chars: { type: 'number' } }),
    execute: async (params) => {
      const path = tools.getWorkspacePath()
      if (!path) throw new Error('No workspace open')
      return readLogbook(path, {
        maxChars: typeof params.max_chars === 'number' ? params.max_chars : undefined,
      })
    },
  })
}
