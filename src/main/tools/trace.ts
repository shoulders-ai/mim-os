import type { ToolRegistry } from '@main/tools/registry.js'
import { computeTraceStats, queryTraceEvents, readTracePayload } from '@main/trace/query.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

const TRACE_FILTER_PROPERTIES = {
  from: { type: 'string' },
  to: { type: 'string' },
  days: { type: 'number' },
  kind: { type: 'string' },
  actor: { type: 'string', enum: ['user', 'ai', 'package', 'system'] },
  tool: { type: 'string' },
  packageId: { type: 'string' },
  sessionId: { type: 'string' },
  runId: { type: 'string' },
  traceId: { type: 'string' },
  status: { type: 'string', enum: ['ok', 'error'] },
  order: { type: 'string', enum: ['asc', 'desc'] },
}

export function registerTraceTools(tools: ToolRegistry): void {
  tools.register({
    name: 'trace.query',
    description: 'Read filtered trace digest events from the current workspace. Payload blob refs are returned by pointer only.',
    inputSchema: objectSchema({
      ...TRACE_FILTER_PROPERTIES,
      limit: { type: 'number' },
    }),
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      return queryTraceEvents(workspace, params)
    },
  })

  tools.register({
    name: 'trace.stats',
    description: 'Aggregate trace counts, errors, durations, model cost, gate decisions, job health, and outcome signals.',
    inputSchema: objectSchema(TRACE_FILTER_PROPERTIES),
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      return computeTraceStats(workspace, params)
    },
  })

  tools.register({
    name: 'trace.payload',
    description: 'Read a captured trace payload blob by its payloadRef (redacted model I/O or tool result).',
    inputSchema: objectSchema({ ref: { type: 'string' } }, ['ref']),
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const result = readTracePayload(workspace, params.ref)
      if (!result) throw new Error('Invalid payload ref')
      return result
    },
  })
}
