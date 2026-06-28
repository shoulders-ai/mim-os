import { parseAllowedHttpUrl, type UrlPolicyOptions } from '@main/web/urlPolicy.js'
import {
  readRenderedUrl,
  type ReadRenderedUrlParams,
  type ReadRenderedUrlResult,
  type RenderedPageRenderer,
} from './readRenderedUrl.js'
import {
  isBrowserSessionAllowed,
  readBrowserSessionSettings,
} from './browserSessionSettings.js'

export interface ReadBrowserSessionUrlResult extends ReadRenderedUrlResult {
  source: 'rendered-stateful'
  allowed_domain: string
}

export interface ReadBrowserSessionUrlDeps extends UrlPolicyOptions {
  workspacePath?: string | null
  render?: BrowserSessionPageRenderer
}

export type BrowserSessionPageRenderer = RenderedPageRenderer

export async function readBrowserSessionUrl(
  params: ReadRenderedUrlParams,
  deps: ReadBrowserSessionUrlDeps = {},
): Promise<ReadBrowserSessionUrlResult> {
  const parsed = parseAllowedHttpUrl(params.url, deps)
  const settings = readBrowserSessionSettings(deps.workspacePath)
  const match = isBrowserSessionAllowed(parsed.href, settings.allowedDomains)
  if (!settings.enabled || !match.allowed || !match.matchedDomain) {
    throw new Error(`Website access is not approved for ${match.host}. Approve this website from chat or add it in Settings > Connections.`)
  }
  const render = deps.render
  if (!render) throw new Error('Stateful web reads are only available in the Electron desktop runtime')

  const result = await readRenderedUrl(params, {
    ...deps,
    render: (request) => render({
      ...request,
      allowedDomains: settings.allowedDomains,
    }),
  })
  return {
    ...result,
    source: 'rendered-stateful',
    allowed_domain: match.matchedDomain,
  }
}
