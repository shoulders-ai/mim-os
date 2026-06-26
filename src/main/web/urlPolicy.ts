export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '[::1]'])

export interface UrlPolicyOptions {
  allowPrivateAddresses?: boolean
}

export class BlockedUrlError extends Error {
  constructor(rawUrl: string) {
    super(`Blocked URL: ${rawUrl} (private/loopback addresses are not allowed)`)
    this.name = 'BlockedUrlError'
  }
}

export function parseAllowedHttpUrl(rawUrl: string, options: UrlPolicyOptions = {}): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are supported, got ${parsed.protocol}`)
  }
  if (!options.allowPrivateAddresses && isBlockedUrl(parsed)) {
    throw new BlockedUrlError(rawUrl)
  }
  return parsed
}

function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 127) return true
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254 && c === 169 && d === 254) return true
  if (a === 0 && b === 0 && c === 0 && d === 0) return true
  return false
}

function parseIpv4MappedHex(host: string): [number, number, number, number] | null {
  const match = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!match) return null
  const hi = parseInt(match[1], 16)
  const lo = parseInt(match[2], 16)
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]
}

function isBlockedUrl(url: URL): boolean {
  if (BLOCKED_HOSTS.has(url.hostname)) return true
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '')
  if (host === '::1') return true
  const mapped = parseIpv4MappedHex(host)
  if (mapped && isPrivateIpv4(...mapped)) return true
  const parts = host.split('.')
  if (parts.length === 4) {
    const nums = parts.map(p => parseInt(p, 10))
    if (nums.every(n => !isNaN(n)) && isPrivateIpv4(nums[0], nums[1], nums[2], nums[3])) return true
  }
  return false
}
