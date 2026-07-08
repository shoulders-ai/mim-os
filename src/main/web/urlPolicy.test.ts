import { describe, expect, it } from 'vitest'
import { BlockedUrlError, parseAllowedHttpUrl } from '@main/web/urlPolicy.js'

describe('URL policy', () => {
  it('allows ordinary http and https URLs', () => {
    expect(parseAllowedHttpUrl('https://example.com/docs').href).toBe('https://example.com/docs')
    expect(parseAllowedHttpUrl('http://example.com/docs').href).toBe('http://example.com/docs')
  })

  it('blocks private, loopback, and link-local IPv4 URLs', () => {
    for (const raw of [
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
})
