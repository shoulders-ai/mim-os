import { describe, expect, it } from 'vitest'
import { BlockedUrlError, isLoopbackUrl, parseAllowedHttpUrl } from '@main/web/urlPolicy.js'

describe('URL policy', () => {
  it('allows ordinary http and https URLs', () => {
    expect(parseAllowedHttpUrl('https://example.com/docs').href).toBe('https://example.com/docs')
    expect(parseAllowedHttpUrl('http://example.com/docs').href).toBe('http://example.com/docs')
  })

  it('blocks private, loopback, and link-local IPv4 URLs', () => {
    for (const raw of [
      'http://localhost/',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://0.0.0.0/',
      'http://2130706433/',
    ]) {
      expect(() => parseAllowedHttpUrl(raw), raw).toThrow(BlockedUrlError)
    }
  })

  it('blocks local, unique-local, and link-local IPv6 URLs', () => {
    for (const raw of [
      'http://[::1]/',
      'http://[::]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[::ffff:10.0.0.1]/',
    ]) {
      expect(() => parseAllowedHttpUrl(raw), raw).toThrow(BlockedUrlError)
    }
  })

  it('keeps the test/development escape hatch explicit', () => {
    expect(parseAllowedHttpUrl('http://127.0.0.1/', { allowPrivateAddresses: true }).href)
      .toBe('http://127.0.0.1/')
  })

  it('can allow loopback without allowing other private addresses', () => {
    for (const raw of [
      'http://localhost:4567/',
      'http://app.localhost:3000/',
      'http://127.0.0.1:8080/',
      'http://127.255.255.254/',
      'http://[::1]:4173/',
      'http://[::ffff:127.0.0.1]/',
    ]) {
      expect(parseAllowedHttpUrl(raw, { allowLoopbackAddresses: true }).href, raw)
        .toBe(new URL(raw).href)
    }

    for (const raw of [
      'http://0.0.0.0/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[fe80::1]/',
      'http://[fd12:3456::1]/',
    ]) {
      expect(
        () => parseAllowedHttpUrl(raw, { allowLoopbackAddresses: true }),
        raw,
      ).toThrow(BlockedUrlError)
    }
  })

  it('does not classify lookalike hostnames as numeric loopback addresses', () => {
    expect(isLoopbackUrl(new URL('http://127example.0example.0example.1example/'))).toBe(false)
  })
})
