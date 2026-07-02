import type { ToolRegistry } from '@main/tools/registry.js'
import type { BrowserSessionPageRenderer } from '@main/web/readBrowserSessionUrl.js'
import type { LiveBrowserDriver } from '@main/web/liveBrowser.js'
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
  liveBrowser?: LiveBrowserDriver
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
    name: 'web.live.open',
    description: 'Open a Markanywhere-style live browser session and return a bounded page observation with compact actionable refs.',
    inputSchema: objectSchema({
      url: { type: 'string', description: 'The URL to open (http/https only)' },
      stateful: { type: 'boolean', description: 'Use approved Website Access profile for granted domains (default false)' },
      visible: { type: 'boolean', description: 'Show the AI-controlled browser window so the user can watch or interact (default false)' },
      timeout_ms: { type: 'number', description: 'Navigation/capture timeout in milliseconds (default 30000)' },
      max_chars: { type: 'number', description: 'Maximum characters in the returned observation (default 100000)' },
      start_from_char: { type: 'number', description: 'Continue the returned observation from this character offset in the cleaned page text' },
    }, ['url']),
    execute: async (params, ctx) => liveBrowser(deps).open({
      url: params.url as string,
      stateful: params.stateful === true,
      visible: params.visible === true,
      timeout_ms: typeof params.timeout_ms === 'number' ? params.timeout_ms : undefined,
      max_chars: typeof params.max_chars === 'number' ? params.max_chars : undefined,
      start_from_char: typeof params.start_from_char === 'number' ? params.start_from_char : undefined,
    }, ctx),
  })

  tools.register({
    name: 'web.live.act',
    description: 'Run one Markanywhere-style live browser action: observe, click, type, scroll, wait, extract, show, hide, or close.',
    inputSchema: objectSchema({
      action: { type: 'string', enum: ['observe', 'click', 'type', 'scroll', 'wait', 'extract', 'show', 'hide', 'close'], description: 'Live browser action to run' },
      ref: { type: 'string', description: 'Action ref from the latest observation for click/type' },
      text: { type: 'string', description: 'Text to enter for type' },
      direction: { type: 'string', enum: ['down', 'up', 'left', 'right'], description: 'Scroll direction (default down)' },
      amount: { type: 'number', description: 'Scroll amount in pixels (default 700)' },
      ms: { type: 'number', description: 'Wait duration for wait action (default 500, capped at 10000)' },
      wait_ms: { type: 'number', description: 'Post-action wait before returning the next observation (default 500)' },
      max_chars: { type: 'number', description: 'Maximum characters in the returned observation (default 100000)' },
      start_from_char: { type: 'number', description: 'Continue returned observation from this character offset in the cleaned page text' },
    }, ['action']),
    execute: async (params, ctx) => executeLiveBrowserAction(liveBrowser(deps), params, ctx),
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

function liveBrowser(deps: WebToolsDeps): LiveBrowserDriver {
  if (!deps.liveBrowser) {
    throw new Error('Live browser is only available in the Electron desktop runtime')
  }
  return deps.liveBrowser
}

async function executeLiveBrowserAction(
  driver: LiveBrowserDriver,
  params: Record<string, unknown>,
  ctx: Parameters<LiveBrowserDriver['open']>[1],
): Promise<unknown> {
  const maxChars = typeof params.max_chars === 'number' ? params.max_chars : undefined
  const startFromChar = typeof params.start_from_char === 'number' ? params.start_from_char : undefined
  const observeParams = {
    max_chars: maxChars,
    start_from_char: startFromChar,
  }
  const observeAfter = async (actionResult: unknown) => {
    const waitMs = typeof params.wait_ms === 'number' ? params.wait_ms : undefined
    try {
      await driver.wait({ ms: waitMs }, ctx)
    } catch {
      await sleep(Math.min(Math.max(waitMs ?? 500, 1), 10_000))
    }
    return {
      action: actionResult,
      observation: await driver.observe(observeParams, ctx),
    }
  }

  switch (params.action) {
    case 'observe':
      return driver.observe(observeParams, ctx)
    case 'click':
      return observeAfter(await driver.click({ ref: requiredString(params.ref, 'ref') }, ctx))
    case 'type':
      return observeAfter(await driver.type({
        ref: requiredString(params.ref, 'ref'),
        text: requiredString(params.text, 'text'),
      }, ctx))
    case 'scroll':
      return observeAfter(await driver.scroll({
        direction: typeof params.direction === 'string' ? params.direction as 'down' | 'up' | 'left' | 'right' : undefined,
        amount: typeof params.amount === 'number' ? params.amount : undefined,
      }, ctx))
    case 'wait':
      await driver.wait({
        ms: typeof params.ms === 'number' ? params.ms : undefined,
      }, ctx)
      return driver.observe(observeParams, ctx)
    case 'extract':
      return driver.extract({
        max_chars: maxChars,
        start_from_char: startFromChar,
      }, ctx)
    case 'show':
      return driver.show({}, ctx)
    case 'hide':
      return driver.hide({}, ctx)
    case 'close':
      return driver.close({}, ctx)
    default:
      throw new Error(`Unsupported live browser action: ${String(params.action)}`)
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`browser action requires ${name}`)
  }
  return value
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
