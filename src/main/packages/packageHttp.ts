import type { HttpClient, HttpResponse } from '@main/integrations/http.js'
import { PackagePermissionError } from '@main/packages/packageErrors.js'

// Package-scoped outbound HTTP. Requests are checked against the manifest
// `permissions.http` host allowlist at call time (the ctx.ai pattern: manifest
// declaration plus package enablement is the consent, no per-call prompt) and
// every request — including failed ones, which audit as status 0 — is audited
// as method + host + path. Never headers, bodies, or query strings, and long
// path segments are redacted, because all of those can carry tokens (Telegram
// bot paths, Slack webhook paths, signed URLs). HTTPS only, default port only.
// The allowlist is checked on the request URL; it is declared intent and audit
// for trusted packages, not a sandbox (backend modules run in the main process).
export interface PackageHttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface PackageHttpAuditEntry {
  method: string
  host: string
  path: string
  status: number
}

export interface PackageHttpApi {
  request(input: PackageHttpRequest): Promise<HttpResponse>
}

// Path segments above this length are likely identifiers or credentials
// (Telegram bot tokens, Slack webhook secrets); audit them as '***'.
const AUDIT_PATH_SEGMENT_MAX = 20

export function redactAuditPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (segment.length > AUDIT_PATH_SEGMENT_MAX ? '***' : segment))
    .join('/')
}

export function hostAllowedByPatterns(host: string, patterns: string[]): boolean {
  const normalized = host.toLowerCase()
  return patterns.some((pattern) => {
    const candidate = pattern.toLowerCase()
    if (candidate === '*') return true
    // `*.example.com` matches subdomains only, never the apex host.
    if (candidate.startsWith('*.')) return normalized.endsWith(candidate.slice(1))
    return normalized === candidate
  })
}

export function createPackageHttpApi(options: {
  packageId: string
  allowed: string[] | undefined
  client: HttpClient
  audit?: (entry: PackageHttpAuditEntry) => void
  signal?: AbortSignal | null
}): PackageHttpApi {
  const { packageId, client } = options
  const allowed = options.allowed ?? []

  return {
    async request(input) {
      let parsed: URL
      try {
        parsed = new URL(input.url)
      } catch {
        // Never echo the raw url: error messages persist unredacted in run
        // records and a malformed url can still carry a credential.
        throw new Error('Invalid package HTTP url')
      }
      if (parsed.protocol !== 'https:') {
        throw new Error('Package HTTP requests must use https')
      }
      // URL parsing normalizes the default port (443) to ''. A host grant the
      // user reviewed should not extend to other services on the same host.
      if (parsed.port !== '') {
        throw new Error('Package HTTP requests must use the default HTTPS port')
      }
      if (!hostAllowedByPatterns(parsed.hostname, allowed)) {
        throw new PackagePermissionError(
          'HOST_NOT_ALLOWED',
          `http:${parsed.hostname}`,
          `Package ${packageId} did not declare HTTP access to host: ${parsed.hostname}`,
        )
      }

      const method = (input.method ?? 'GET').toUpperCase()
      const auditPath = redactAuditPath(parsed.pathname)
      try {
        const response = await client.request({
          url: input.url,
          method,
          headers: input.headers,
          body: input.body,
          signal: options.signal ?? undefined,
          redirect: 'manual',
        })
        options.audit?.({ method, host: parsed.hostname, path: auditPath, status: response.status })
        return response
      } catch (err) {
        // The request was attempted (and may have reached the server) even if
        // it failed or was aborted; audit it with a sentinel status.
        options.audit?.({ method, host: parsed.hostname, path: auditPath, status: 0 })
        throw err
      }
    },
  }
}
