import type { ToolRegistry } from '@main/tools/registry.js'
import type { HistoryStore } from '@main/history/history.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required`)
  return value
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key]
  return typeof value === 'boolean' ? value : undefined
}

export function registerHistoryTools(tools: ToolRegistry, history: HistoryStore): void {
  tools.register({
    name: 'history.list',
    description: 'List local recovery versions for a workspace file.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      include_folded: { type: 'boolean' },
    }, ['path']),
    execute: async (params) => history.listFileVersions(requireString(params, 'path'), {
      includeFolded: optionalBoolean(params, 'include_folded') ?? false,
    }),
  })

  tools.register({
    name: 'history.preview',
    description: 'Preview a local recovery version. Text versions include content; binary versions report metadata only.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      version_id: { type: 'string' },
    }, ['path', 'version_id']),
    execute: async (params) => history.previewVersion(
      requireString(params, 'path'),
      requireString(params, 'version_id'),
    ),
  })

  tools.register({
    name: 'history.restore',
    description: 'Restore a file to a local recovery version. The restore itself is captured as a new recovery point.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      version_id: { type: 'string' },
    }, ['path', 'version_id']),
    execute: async (params) => ({
      restored: history.restoreVersion(
        requireString(params, 'path'),
        requireString(params, 'version_id'),
      ),
    }),
  })

  tools.register({
    name: 'history.openVersion',
    description: 'Write a recovery version to a temporary file so it can be opened without changing the workspace file.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      version_id: { type: 'string' },
    }, ['path', 'version_id']),
    execute: async (params) => history.writeVersionTempFile(
      requireString(params, 'path'),
      requireString(params, 'version_id'),
    ),
  })

  tools.register({
    name: 'history.stats',
    description: 'Report local recovery storage use for the current workspace.',
    inputSchema: objectSchema({}),
    execute: async () => history.stats(),
  })

  tools.register({
    name: 'history.clear',
    description: 'Clear local recovery history for the current workspace without touching workspace files.',
    inputSchema: objectSchema({}),
    execute: async () => {
      history.clear()
      return { ok: true }
    },
  })

  tools.register({
    name: 'history.prune',
    description: 'Thin local recovery storage to the currently visible version-density policy.',
    inputSchema: objectSchema({}),
    execute: async () => history.prune(),
  })

  tools.register({
    name: 'history.baseline',
    description: 'Create initial local recovery points for eligible workspace files that do not have history yet.',
    inputSchema: objectSchema({}),
    execute: async () => history.baselineWorkspace(),
  })
}
