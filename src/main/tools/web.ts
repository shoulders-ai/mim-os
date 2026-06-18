import type { ToolRegistry } from '@main/tools/registry.js'
import { readUrl } from '@main/web/readUrl.js'
import { webSearch } from '@main/web/webSearch.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerWebTools(tools: ToolRegistry): void {
  tools.register({
    name: 'web.read',
    description: 'Fetch a URL and return cleaned markdown-formatted text content using Mozilla Readability extraction.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to fetch (http/https only)' },
      max_chars: { type: 'number', description: 'Maximum characters to return (default 80000)' },
      timeout_ms: { type: 'number', description: 'Fetch timeout in milliseconds (default 15000)' },
    }, ['url']),
    execute: async (params) => {
      return readUrl({
        url: params.url as string,
        max_chars: typeof params.max_chars === 'number' ? params.max_chars : 80_000,
        timeout_ms: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
      })
    },
  })

  tools.register({
    name: 'web.search',
    description: 'Search the web via Exa and return results with title, URL, and snippet. Requires EXA_API_KEY.',
    inputSchema: objectSchema({
      query: { type: 'string', description: 'The search query' },
      max_results: { type: 'number', description: 'Maximum results to return (default 10)' },
    }, ['query']),
    execute: async (params) => {
      return webSearch({
        query: params.query as string,
        max_results: typeof params.max_results === 'number' ? params.max_results : undefined,
      })
    },
  })
}
