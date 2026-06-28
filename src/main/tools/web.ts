import type { ToolRegistry } from '@main/tools/registry.js'
import type { BrowserSessionPageRenderer } from '@main/web/readBrowserSessionUrl.js'
import { readWebUrl, type WebPageRenderer } from '@main/web/readWebUrl.js'
import type { FetchLike } from '@main/web/readUrl.js'
import {
  addBrowserSessionDomain,
  readBrowserSessionSettings,
  removeBrowserSessionDomain,
} from '@main/web/browserSessionSettings.js'
import { webSearch } from '@main/web/webSearch.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export interface WebToolsDeps {
  fetch?: FetchLike
  renderRenderedPage?: WebPageRenderer
  renderSavedBrowserSessionPage?: BrowserSessionPageRenderer
  openSavedBrowserSession?: (params: { url?: string }) => Promise<unknown> | unknown
  clearSavedBrowserSessionProfile?: () => Promise<unknown> | unknown
}

export function registerWebTools(tools: ToolRegistry, deps: WebToolsDeps = {}): void {
  tools.register({
    name: 'web.read',
    description: 'Read a URL through the workhorse web reader: PDFs use local text extraction, ordinary pages render in stateless Chromium, and stateful=true uses approved website access for granted domains.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to read (http/https only)' },
      stateful: { type: 'boolean', description: 'Use approved website access for granted domains (default false)' },
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
        renderBrowserSession: deps.renderSavedBrowserSessionPage,
      })
    },
  })

  tools.register({
    name: 'web.browser.status',
    description: 'Return website access enablement, domain grants, and runtime availability.',
    inputSchema: objectSchema({}),
    execute: async () => ({
      ...readBrowserSessionSettings(tools.getWorkspacePath()),
      profile_available: Boolean(deps.renderSavedBrowserSessionPage || deps.openSavedBrowserSession || deps.clearSavedBrowserSessionProfile),
    }),
  })

  tools.register({
    name: 'web.browser.allowDomain',
    description: 'Approve website access for a domain.',
    inputSchema: objectSchema({
      domain: { type: 'string', description: 'Exact domain or wildcard domain such as example.com or *.example.com' },
    }, ['domain']),
    execute: async (params) => addBrowserSessionDomain(workspacePath(tools), params.domain as string),
  })

  tools.register({
    name: 'web.browser.removeDomain',
    description: 'Remove a website access domain grant.',
    inputSchema: objectSchema({
      domain: { type: 'string', description: 'Exact domain or wildcard domain to remove' },
    }, ['domain']),
    execute: async (params) => removeBrowserSessionDomain(workspacePath(tools), params.domain as string),
  })

  tools.register({
    name: 'web.browser.open',
    description: 'Open a visible browser window to set up website access.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'Optional http/https URL to open for login or consent setup' },
    }),
    execute: async (params) => {
      if (!deps.openSavedBrowserSession) {
        throw new Error('Website access setup is only available in the Electron desktop runtime')
      }
      return deps.openSavedBrowserSession({
        url: typeof params.url === 'string' && params.url.trim() ? params.url : undefined,
      })
    },
  })

  tools.register({
    name: 'web.browser.clearProfile',
    description: 'Clear cookies, storage, and cache used for website access.',
    inputSchema: objectSchema({}),
    execute: async () => {
      if (!deps.clearSavedBrowserSessionProfile) {
        throw new Error('Website access clearing is only available in the Electron desktop runtime')
      }
      return deps.clearSavedBrowserSessionProfile()
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
