import type { ToolRegistry } from '@main/tools/registry.js'
import { searchSessions } from '@main/search/search.js'
import { searchFiles } from '@main/search/fileSearch.js'

// search.files backs the Files view's type-ahead search: each keystroke-pause
// fires a new query, so a new call aborts the previous in-flight scan. The AI
// `search` tool is turn-scoped and stays independent of this controller.
let activeFileSearch: AbortController | null = null

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerSearchTools(tools: ToolRegistry): void {
  tools.register({
    name: 'search.sessions',
    description: 'Full-text search across session message history',
    inputSchema: objectSchema({
      query: { type: 'string' },
      max_results: { type: 'number' },
    }, ['query']),
    execute: async (params) => {
      const query = params.query as string
      if (!query) throw new Error('Missing required parameter: query')
      const maxResults = (params.max_results as number) || 30
      return { results: searchSessions(query, maxResults) }
    }
  })

  tools.register({
    name: 'search.files',
    description: 'Search workspace file contents for a query string',
    inputSchema: objectSchema({
      query: { type: 'string' },
      pattern: { type: 'string' },
      max_results: { type: 'number' },
    }, ['query']),
    execute: async (params) => {
      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')
      const query = params.query as string
      if (!query) throw new Error('Missing required parameter: query')
      const pattern = params.pattern as string | undefined
      const maxResults = (params.max_results as number) || 50
      activeFileSearch?.abort()
      const controller = new AbortController()
      activeFileSearch = controller
      try {
        return { results: await searchFiles(workspacePath, query, { pattern, maxResults, signal: controller.signal }) }
      } finally {
        if (activeFileSearch === controller) activeFileSearch = null
      }
    }
  })

  tools.register({
    name: 'search',
    description: 'Search workspace files and/or session history. Use scope to target: "files", "sessions", or "all" (default).',
    execute: async (params) => {
      const query = params.query as string
      if (!query) throw new Error('Missing required parameter: query')
      const scope = (params.scope as string) || 'all'
      const maxResults = (params.max_results as number) || 20
      const pattern = params.file_pattern as string | undefined

      const result: Record<string, unknown> = {}

      if (scope === 'all' || scope === 'sessions') {
        result.sessions = searchSessions(query, maxResults)
      }
      if (scope === 'all' || scope === 'files') {
        const workspacePath = tools.getWorkspacePath()
        if (workspacePath) {
          result.files = await searchFiles(workspacePath, query, { pattern, maxResults })
        }
      }

      return result
    }
  })
}
