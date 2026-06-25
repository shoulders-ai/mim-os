import { parseAllowedHttpUrl, type UrlPolicyOptions } from '@main/web/urlPolicy.js'
import {
  readRenderedUrl,
  type ReadRenderedUrlParams,
  type ReadRenderedUrlResult,
  type RenderedCaptureInfo,
  type RenderedPageRenderer,
} from './readRenderedUrl.js'
import {
  isResearchBrowserAllowed,
  readResearchBrowserSettings,
  recordResearchBrowserSourceRead,
} from './researchSettings.js'

export type ResearchReadStatus =
  | 'ok'
  | 'partial'
  | 'empty_capture'
  | 'consent_required'
  | 'login_required'
  | 'captcha_required'
  | 'security_verification'
  | 'site_error'

export interface ResearchReadClassification {
  status: ResearchReadStatus
  attention_required: boolean
  reason?: string
}

export interface ReadResearchUrlResult extends ReadRenderedUrlResult, ResearchReadClassification {
  source: 'research-profile'
  allowed_domain: string
}

export interface ReadResearchUrlDeps extends UrlPolicyOptions {
  workspacePath?: string | null
  render?: ResearchPageRenderer
  now?: () => Date
  recordSourceState?: boolean
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
    throw new Error(`Research browser is not allowed for ${match.host}. Add this domain to Research Browser settings first.`)
  }
  if (!deps.render) throw new Error('web.readResearch is only available in the Electron desktop runtime')

  const result = await readRenderedUrl(params, {
    ...deps,
    render: deps.render,
  })
  const classification = classifyRenderedRead({
    title: result.title,
    content: result.content,
    capture: result.capture,
  })
  if (deps.recordSourceState !== false) {
    recordResearchBrowserSourceRead(deps.workspacePath, {
      domain: match.matchedDomain,
      url: params.url,
      status: classification.status,
      attentionRequired: classification.attention_required,
      source: 'research-profile',
      ...(classification.reason ? { reason: classification.reason } : {}),
      at: (deps.now?.() ?? new Date()).toISOString(),
    })
  }
  return {
    ...result,
    ...classification,
    source: 'research-profile',
    allowed_domain: match.matchedDomain,
  }
}

export function classifyRenderedRead(input: { title?: string, content: string, capture?: RenderedCaptureInfo }): ResearchReadClassification {
  const title = input.title?.trim() ?? ''
  const content = input.content.trim()
  const haystack = `${title}\n${content}`.toLowerCase()
  if (!content) {
    return {
      status: 'empty_capture',
      attention_required: true,
      reason: 'The page rendered without readable content.',
    }
  }
  if (containsAny(haystack, [
    'before you continue to google',
    'consent.google.com',
    'we value your privacy',
    'accept cookies',
    'cookie consent',
    'privacy choices',
  ])) {
    return {
      status: 'consent_required',
      attention_required: true,
      reason: 'The page is showing a consent or privacy interstitial.',
    }
  }
  if (containsAny(haystack, [
    'captcha',
    'recaptcha',
    'hcaptcha',
    'are you a robot',
    'prove you are human',
  ])) {
    return {
      status: 'captcha_required',
      attention_required: true,
      reason: 'The page is asking for a human verification challenge.',
    }
  }
  if (containsAny(haystack, [
    'just a moment',
    'security verification',
    'checking your browser',
    'verify you are human',
    'performing security verification',
  ])) {
    return {
      status: 'security_verification',
      attention_required: true,
      reason: 'The page is showing a security verification interstitial.',
    }
  }
  if (containsAny(haystack, [
    'sign in to continue',
    'log in to continue',
    'login to continue',
    'please sign in',
    'please log in',
  ]) || /(^|\n)#?\s*(sign in|log in)\s*($|\n)/i.test(`${title}\n${content}`)) {
    return {
      status: 'login_required',
      attention_required: true,
      reason: 'The page is asking for an authenticated session.',
    }
  }
  if (containsAny(haystack, [
    'page not found',
    'error page',
    'da ist etwas schief gelaufen',
    'something went wrong',
    'access denied',
  ])) {
    return {
      status: 'site_error',
      attention_required: true,
      reason: 'The page rendered a site error rather than the requested content.',
    }
  }
  if (input.capture?.status === 'partial') {
    return {
      status: 'partial',
      attention_required: false,
      reason: input.capture.reason
        ? `Potential timeout or incomplete capture: ${input.capture.reason}`
        : 'Potential timeout or incomplete capture. Inspect the returned content and capture signals before asking the user for help.',
    }
  }
  if (isWeakCapture(content, input.capture)) {
    return {
      status: 'partial',
      attention_required: false,
      reason: 'The browser capture contains very little readable content. Inspect the returned content and capture signals; retry with a longer timeout or use Research Browser setup only if the evidence shows missing access or session state.',
    }
  }
  return { status: 'ok', attention_required: false }
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some(needle => value.includes(needle))
}

function isWeakCapture(content: string, capture: RenderedCaptureInfo | undefined): boolean {
  const visibleChars = capture?.signals?.visible_text_chars ?? textChars(content)
  const structuralSignals = (capture?.signals?.link_count ?? 0)
    + (capture?.signals?.button_count ?? 0)
    + (capture?.signals?.form_control_count ?? 0)
    + (capture?.signals?.table_row_count ?? 0)
    + (capture?.signals?.heading_count ?? 0)
    + (capture?.signals?.image_count ?? 0)
  return visibleChars > 0 && visibleChars < 20 && structuralSignals === 0
}

function textChars(content: string): number {
  return content
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/[`*_#[\]|>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length
}
