import { parseAllowedHttpUrl, type UrlPolicyOptions } from '@main/web/urlPolicy.js'
import {
  readRenderedUrl,
  type ReadRenderedUrlParams,
  type ReadRenderedUrlResult,
  type RenderedPageRenderer,
} from './readRenderedUrl.js'
import {
  isResearchBrowserAllowed,
  readResearchBrowserSettings,
} from './researchSettings.js'

export interface ReadResearchUrlResult extends ReadRenderedUrlResult {
  source: 'rendered-stateful'
  allowed_domain: string
}

export interface ReadResearchUrlDeps extends UrlPolicyOptions {
  workspacePath?: string | null
  render?: ResearchPageRenderer
}

export type ResearchPageRenderer = RenderedPageRenderer

export async function readResearchUrl(
  params: ReadRenderedUrlParams,
  deps: ReadResearchUrlDeps = {},
): Promise<ReadResearchUrlResult> {
  const parsed = parseAllowedHttpUrl(params.url, deps)
  const settings = readResearchBrowserSettings(deps.workspacePath)
  const match = isResearchBrowserAllowed(parsed.href, settings.allowedDomains)
  if (!settings.enabled || !match.allowed || !match.matchedDomain) {
    throw new Error(`Research Browser is not allowed for ${match.host}. Add this domain in Settings > Connections first.`)
  }
  if (!deps.render) throw new Error('Stateful web reads are only available in the Electron desktop runtime')

  const result = await readRenderedUrl(params, {
    ...deps,
    render: deps.render,
  })
  return {
    ...result,
    source: 'rendered-stateful',
    allowed_domain: match.matchedDomain,
  }
}
