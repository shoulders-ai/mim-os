import { describe, expect, it, vi } from 'vitest'
import type { HttpClient, HttpResponse } from '@main/integrations/http.js'
import { createPackageHttpApi, hostAllowedByPatterns } from '@main/packages/packageHttp.js'

function fakeResponse(): HttpResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
    text: async () => 'ok',
  }
}

function fakeClient(): HttpClient & { request: ReturnType<typeof vi.fn> } {
  return { request: vi.fn(async () => fakeResponse()) }
}

describe('host allowlist matching', () => {
  it('matches exact hosts case-insensitively', () => {
    expect(hostAllowedByPatterns('api.github.com', ['api.github.com'])).toBe(true)
    expect(hostAllowedByPatterns('API.GitHub.com', ['api.github.com'])).toBe(true)
    expect(hostAllowedByPatterns('github.com', ['api.github.com'])).toBe(false)
  })

  it('matches *. wildcards against subdomains only', () => {
    expect(hostAllowedByPatterns('api.github.com', ['*.github.com'])).toBe(true)
    expect(hostAllowedByPatterns('uploads.api.github.com', ['*.github.com'])).toBe(true)
    expect(hostAllowedByPatterns('github.com', ['*.github.com'])).toBe(false)
    expect(hostAllowedByPatterns('evilgithub.com', ['*.github.com'])).toBe(false)
  })

  it('matches any host for the * pattern', () => {
    expect(hostAllowedByPatterns('anything.example.org', ['*'])).toBe(true)
  })
})

describe('package http api', () => {
  it('forwards allowed requests to the http client and returns the response', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client })

    const res = await http.request({
      url: 'https://api.github.com/orgs/acme/repos?page=2',
      method: 'GET',
      headers: { Authorization: 'token ghp_abc' },
    })

    expect(res.status).toBe(200)
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.github.com/orgs/acme/repos?page=2',
      method: 'GET',
      headers: { Authorization: 'token ghp_abc' },
    }))
  })

  it('rejects hosts the manifest did not declare', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client })

    await expect(http.request({ url: 'https://example.com/x' }))
      .rejects.toThrow('Package github-monitor did not declare HTTP access to host: example.com')
    expect(client.request).not.toHaveBeenCalled()
  })

  it('rejects every request when the manifest declares no http permission', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: undefined, client })

    await expect(http.request({ url: 'https://api.github.com/user' }))
      .rejects.toThrow('did not declare HTTP access')
  })

  it('rejects non-HTTPS urls', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client })

    await expect(http.request({ url: 'http://api.github.com/user' }))
      .rejects.toThrow('Package HTTP requests must use https')
    expect(client.request).not.toHaveBeenCalled()
  })

  it('rejects invalid urls without echoing the raw url into the error', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client })

    // A malformed url can carry a credential (template bug); error messages are
    // persisted unredacted in run records, so the input must not be reflected.
    await expect(http.request({ url: 'https://api host/x?token=ghp_leaky' }))
      .rejects.toSatisfy((err: Error) => /Invalid package HTTP url/.test(err.message) && !err.message.includes('ghp_leaky'))
  })

  it('rejects urls with an explicit port', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client })

    await expect(http.request({ url: 'https://api.github.com:8443/user' }))
      .rejects.toThrow('Package HTTP requests must use the default HTTPS port')
    // The default port is normalized away by URL parsing and stays allowed.
    await expect(http.request({ url: 'https://api.github.com:443/user' })).resolves.toBeDefined()
    expect(client.request).toHaveBeenCalledTimes(1)
  })

  it('audits method, host, path, and status but never headers or bodies', async () => {
    const client = fakeClient()
    const audit = vi.fn()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client, audit })

    await http.request({
      url: 'https://api.github.com/orgs/acme/repos?access_token=leaky',
      method: 'POST',
      headers: { Authorization: 'token ghp_abc' },
      body: '{"secret":"x"}',
    })

    expect(audit).toHaveBeenCalledTimes(1)
    const entry = audit.mock.calls[0][0]
    expect(entry).toEqual({ method: 'POST', host: 'api.github.com', path: '/orgs/acme/repos', status: 200 })
    expect(JSON.stringify(entry)).not.toContain('ghp_abc')
    expect(JSON.stringify(entry)).not.toContain('leaky')
  })

  it('redacts token-like path segments in the audit entry', async () => {
    const client = fakeClient()
    const audit = vi.fn()
    const http = createPackageHttpApi({ packageId: 'notifier', allowed: ['*'], client, audit })

    // Telegram-style path-borne credential: the token lives in the path itself.
    await http.request({ url: 'https://api.telegram.org/bot123456789:AAEpx7vqkz9YBQwT3fJ2mHs/sendMessage' })

    const entry = audit.mock.calls[0][0]
    expect(entry.path).toBe('/***/sendMessage')
    expect(JSON.stringify(entry)).not.toContain('AAEpx7vqkz9YBQwT3fJ2mHs')
  })

  it('audits failed requests with status 0 before rethrowing', async () => {
    const client: HttpClient = { request: vi.fn(async () => { throw new Error('network down') }) }
    const audit = vi.fn()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client, audit })

    await expect(http.request({ url: 'https://api.github.com/user' })).rejects.toThrow('network down')
    expect(audit).toHaveBeenCalledWith({ method: 'GET', host: 'api.github.com', path: '/user', status: 0 })
  })

  it('passes redirect: manual so redirects do not bypass the host allowlist', async () => {
    const client = fakeClient()
    const http = createPackageHttpApi({ packageId: 'github-monitor', allowed: ['api.github.com'], client })

    await http.request({ url: 'https://api.github.com/user' })

    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'manual' }))
  })

  it('passes the abort signal through to the client', async () => {
    const client = fakeClient()
    const controller = new AbortController()
    const http = createPackageHttpApi({
      packageId: 'github-monitor',
      allowed: ['api.github.com'],
      client,
      signal: controller.signal,
    })

    await http.request({ url: 'https://api.github.com/user' })

    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
  })
})
