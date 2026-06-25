import type { ToolRegistry } from '@main/tools/registry.js'
import { readAutoUrl, type AutoPageRenderer } from '@main/web/readAutoUrl.js'
import { readResearchUrl, type ResearchPageRenderer } from '@main/web/readResearchUrl.js'
import { readRenderedUrl, type RenderedPageRenderer } from '@main/web/readRenderedUrl.js'
import {
  addResearchBrowserDomain,
  readResearchBrowserSettings,
  removeResearchBrowserDomain,
} from '@main/web/researchSettings.js'
import { readUrl } from '@main/web/readUrl.js'
import { webSearch } from '@main/web/webSearch.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export interface WebToolsDeps {
  renderRenderedPage?: RenderedPageRenderer
  renderResearchPage?: ResearchPageRenderer
  openResearchBrowser?: (params: { url?: string }) => Promise<unknown> | unknown
  clearResearchBrowserProfile?: () => Promise<unknown> | unknown
}

export function registerWebTools(tools: ToolRegistry, deps: WebToolsDeps = {}): void {
  tools.register({
    name: 'web.read',
    description: 'Fetch an HTML/plain-text page or selectable PDF URL and return cleaned markdown-formatted text content.',
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
    name: 'web.readAuto',
    description: 'Read a URL through the best available web reader: rendered Chromium first with adaptive readiness and partial capture evidence, then the persistent Research Browser profile for configured sources when stateless rendering is blocked, then a recent workspace cache entry when live reads need attention.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to read (http/https only)' },
      max_chars: { type: 'number', description: 'Target maximum characters for the returned chunk (default 100000)' },
      start_from_char: { type: 'number', description: 'Continue reading from this character offset in the full Markdown output' },
      extract_links: { type: 'boolean', description: 'Preserve link URLs in Markdown (default false)' },
      extract_images: { type: 'boolean', description: 'Preserve image URLs in table/header contexts (default false)' },
      timeout_ms: { type: 'number', description: 'Render timeout in milliseconds (default 30000)' },
      prefer_research: { type: 'boolean', description: 'Use the Research Browser profile first when the domain is configured (default false)' },
    }, ['url']),
    execute: async (params) => {
      return readAutoUrl({
        url: params.url as string,
        max_chars: typeof params.max_chars === 'number' ? params.max_chars : undefined,
        start_from_char: typeof params.start_from_char === 'number' ? params.start_from_char : undefined,
        extract_links: params.extract_links === true,
        extract_images: params.extract_images === true,
        timeout_ms: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
        prefer_research: params.prefer_research === true,
      }, {
        workspacePath: tools.getWorkspacePath(),
        renderRendered: deps.renderRenderedPage as AutoPageRenderer | undefined,
        renderResearch: deps.renderResearchPage,
      })
    },
  })

  tools.register({
    name: 'web.readRendered',
    description: 'Render a URL in Chromium and return cleaned markdown content from the hydrated page, with adaptive readiness, partial capture evidence, and structure-aware chunk continuation.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to render (http/https only)' },
      max_chars: { type: 'number', description: 'Target maximum characters for the returned chunk (default 100000)' },
      start_from_char: { type: 'number', description: 'Continue reading from this character offset in the full Markdown output' },
      extract_links: { type: 'boolean', description: 'Preserve link URLs in Markdown (default false)' },
      extract_images: { type: 'boolean', description: 'Preserve image URLs in table/header contexts (default false)' },
      timeout_ms: { type: 'number', description: 'Render timeout in milliseconds (default 30000)' },
    }, ['url']),
    execute: async (params) => {
      return readRenderedUrl({
        url: params.url as string,
        max_chars: typeof params.max_chars === 'number' ? params.max_chars : undefined,
        start_from_char: typeof params.start_from_char === 'number' ? params.start_from_char : undefined,
        extract_links: params.extract_links === true,
        extract_images: params.extract_images === true,
        timeout_ms: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
      }, { render: deps.renderRenderedPage })
    },
  })

  tools.register({
    name: 'web.readResearch',
    description: 'Read a URL through the persistent Research Browser profile and return cleaned markdown plus blocked-page status.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to render through the Research Browser profile (http/https only)' },
      max_chars: { type: 'number', description: 'Target maximum characters for the returned chunk (default 100000)' },
      start_from_char: { type: 'number', description: 'Continue reading from this character offset in the full Markdown output' },
      extract_links: { type: 'boolean', description: 'Preserve link URLs in Markdown (default false)' },
      extract_images: { type: 'boolean', description: 'Preserve image URLs in table/header contexts (default false)' },
      timeout_ms: { type: 'number', description: 'Render timeout in milliseconds (default 30000)' },
    }, ['url']),
    execute: async (params) => {
      return readResearchUrl({
        url: params.url as string,
        max_chars: typeof params.max_chars === 'number' ? params.max_chars : undefined,
        start_from_char: typeof params.start_from_char === 'number' ? params.start_from_char : undefined,
        extract_links: params.extract_links === true,
        extract_images: params.extract_images === true,
        timeout_ms: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
      }, {
        workspacePath: workspacePath(tools),
        render: deps.renderResearchPage,
      })
    },
  })

  tools.register({
    name: 'web.research.status',
    description: 'Return Research Browser enablement, domain grants, source health, and runtime availability.',
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
