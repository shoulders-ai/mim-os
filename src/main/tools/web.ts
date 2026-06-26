import type { ToolRegistry } from '@main/tools/registry.js'
import type { ResearchPageRenderer } from '@main/web/readResearchUrl.js'
import { readWebUrl, type WebPageRenderer } from '@main/web/readWebUrl.js'
import type { FetchLike } from '@main/web/readUrl.js'
import {
  addResearchBrowserDomain,
  readResearchBrowserSettings,
  removeResearchBrowserDomain,
} from '@main/web/researchSettings.js'
import { webSearch } from '@main/web/webSearch.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export interface WebToolsDeps {
  fetch?: FetchLike
  renderRenderedPage?: WebPageRenderer
  renderResearchPage?: ResearchPageRenderer
  openResearchBrowser?: (params: { url?: string }) => Promise<unknown> | unknown
  clearResearchBrowserProfile?: () => Promise<unknown> | unknown
}

export function registerWebTools(tools: ToolRegistry, deps: WebToolsDeps = {}): void {
  tools.register({
    name: 'web.read',
    description: 'Read a URL through the workhorse web reader: PDFs use local text extraction, ordinary pages render in stateless Chromium, and stateful=true uses the persistent Research Browser profile for granted domains.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to read (http/https only)' },
      stateful: { type: 'boolean', description: 'Use the persistent Research Browser profile for granted domains (default false)' },
      max_chars: { type: 'number', description: 'Target maximum characters for the returned chunk (default 100000)' },
      start_from_char: { type: 'number', description: 'Continue reading from this character offset in the full Markdown output' },
      extract_links: { type: 'boolean', description: 'Preserve link URLs in Markdown (default false)' },
      extract_images: { type: 'boolean', description: 'Preserve image URLs in table/header contexts (default false)' },
      timeout_ms: { type: 'number', description: 'Render/fetch timeout in milliseconds (default 30000)' },
    }, ['url']),
    execute: async (params) => {
      return readWebUrl({
        url: params.url as string,
        stateful: params.stateful === true,
        max_chars: typeof params.max_chars === 'number' ? params.max_chars : undefined,
        start_from_char: typeof params.start_from_char === 'number' ? params.start_from_char : undefined,
        extract_links: params.extract_links === true,
        extract_images: params.extract_images === true,
        timeout_ms: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
      }, {
        workspacePath: tools.getWorkspacePath(),
        fetch: deps.fetch,
        renderRendered: deps.renderRenderedPage,
        renderResearch: deps.renderResearchPage,
      })
    },
  })

  tools.register({
    name: 'web.research.status',
    description: 'Return Research Browser enablement, domain grants, and runtime availability.',
    inputSchema: objectSchema({}),
    execute: async () => ({
      ...readResearchBrowserSettings(tools.getWorkspacePath()),
      profile_available: Boolean(deps.renderResearchPage || deps.openResearchBrowser || deps.clearResearchBrowserProfile),
    }),
  })

  tools.register({
    name: 'web.research.allowDomain',
    description: 'Allow the persistent Research Browser profile to read a domain asynchronously.',
    inputSchema: objectSchema({
      domain: { type: 'string', description: 'Exact domain or wildcard domain such as example.com or *.example.com' },
    }, ['domain']),
    execute: async (params) => addResearchBrowserDomain(workspacePath(tools), params.domain as string),
  })

  tools.register({
    name: 'web.research.removeDomain',
    description: 'Remove a Research Browser domain grant.',
    inputSchema: objectSchema({
      domain: { type: 'string', description: 'Exact domain or wildcard domain to remove' },
    }, ['domain']),
    execute: async (params) => removeResearchBrowserDomain(workspacePath(tools), params.domain as string),
  })

  tools.register({
    name: 'web.research.open',
    description: 'Open the visible Research Browser setup window using the persistent profile.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'Optional http/https URL to open for login or consent setup' },
    }),
    execute: async (params) => {
      if (!deps.openResearchBrowser) {
        throw new Error('Research browser setup is only available in the Electron desktop runtime')
      }
      return deps.openResearchBrowser({
        url: typeof params.url === 'string' && params.url.trim() ? params.url : undefined,
      })
    },
  })

  tools.register({
    name: 'web.research.clearProfile',
    description: 'Clear cookies, storage, and cache from the persistent Research Browser profile.',
    inputSchema: objectSchema({}),
    execute: async () => {
      if (!deps.clearResearchBrowserProfile) {
        throw new Error('Research browser profile clearing is only available in the Electron desktop runtime')
      }
      return deps.clearResearchBrowserProfile()
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

function workspacePath(tools: ToolRegistry): string {
  const workspacePath = tools.getWorkspacePath()
  if (!workspacePath) throw new Error('No workspace open')
  return workspacePath
}
