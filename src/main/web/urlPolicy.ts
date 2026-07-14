export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export interface UrlPolicyOptions {
  allowPrivateAddresses?: boolean
  allowLoopbackAddresses?: boolean
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
  const loopbackAllowed = options.allowLoopbackAddresses === true && isLoopbackUrl(parsed)
  if (!options.allowPrivateAddresses && !loopbackAllowed && isBlockedUrl(parsed)) {
    throw new BlockedUrlError(rawUrl)
  }
  return parsed
}

function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 127) return true
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
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

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null
  const nums = parts.map(Number)
  if (nums.some(num => num > 255)) return null
  return nums as [number, number, number, number]
}

export function isLoopbackUrl(url: URL): boolean {
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const mapped = parseIpv4MappedHex(host)
  if (mapped?.[0] === 127) return true
  return parseIpv4(host)?.[0] === 127
}

function isBlockedUrl(url: URL): boolean {
  if (isLoopbackUrl(url)) return true
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (host === '::') return true
  const mapped = parseIpv4MappedHex(host)
  if (mapped && isPrivateIpv4(...mapped)) return true
  if (isPrivateIpv6(host)) return true
  const ipv4 = parseIpv4(host)
  if (ipv4 && isPrivateIpv4(...ipv4)) return true
  return false
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) return false
  const firstHextet = parseInt(host.split(':')[0] || '0', 16)
  if (!Number.isFinite(firstHextet)) return false
  // fc00::/7 unique-local and fe80::/10 link-local.
  if ((firstHextet & 0xfe00) === 0xfc00) return true
  if ((firstHextet & 0xffc0) === 0xfe80) return true
  return false
}
