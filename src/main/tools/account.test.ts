import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { registerAccountTools, readAccountToken, MIM_ACCOUNT_TOKEN_KEY } from './account.js'

describe('Account tools', () => {
  let home: string
  let tools: ReturnType<typeof createToolRegistry>
  let emitted: string[]
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-account-test-'))
    emitted = []
    tools = createToolRegistry(createTraceLog())
    registerAccountTools(tools, (channel) => { emitted.push(channel) }, { home })
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  // ── account.setToken ──

  it('saves a token to keys.env and emits account:changed', async () => {
    const result = await tools.call('account.setToken', { token: 'tok_abc123' }, ctx) as { saved: boolean }

    expect(result.saved).toBe(true)
    expect(emitted).toContain('account:changed')

    const content = readFileSync(join(home, '.mim', 'keys.env'), 'utf-8')
    expect(content).toContain(`${MIM_ACCOUNT_TOKEN_KEY}=tok_abc123`)
  })

  it('creates .mim directory and keys.env when they do not exist', async () => {
    await tools.call('account.setToken', { token: 'tok_new' }, ctx)

    const keysPath = join(home, '.mim', 'keys.env')
    expect(readFileSync(keysPath, 'utf-8')).toContain(`${MIM_ACCOUNT_TOKEN_KEY}=tok_new`)
    // File should be user-only readable
    const mode = statSync(keysPath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('replaces an existing token line', async () => {
    const keysDir = join(home, '.mim')
    mkdirSync(keysDir, { recursive: true })
    writeFileSync(join(keysDir, 'keys.env'), `OTHER_KEY=foo\n${MIM_ACCOUNT_TOKEN_KEY}=old_token\n`)

    await tools.call('account.setToken', { token: 'tok_replaced' }, ctx)

    const content = readFileSync(join(keysDir, 'keys.env'), 'utf-8')
    expect(content).toContain('OTHER_KEY=foo')
    expect(content).toContain(`${MIM_ACCOUNT_TOKEN_KEY}=tok_replaced`)
    expect(content).not.toContain('old_token')
  })

  // ── account.clearToken ──

  it('removes the token line from keys.env and emits account:changed', async () => {
    const keysDir = join(home, '.mim')
    mkdirSync(keysDir, { recursive: true })
    writeFileSync(join(keysDir, 'keys.env'), `OTHER_KEY=foo\n${MIM_ACCOUNT_TOKEN_KEY}=tok_remove\n`)

    const result = await tools.call('account.clearToken', {}, ctx) as { cleared: boolean }

    expect(result.cleared).toBe(true)
    expect(emitted).toContain('account:changed')

    const content = readFileSync(join(keysDir, 'keys.env'), 'utf-8')
    expect(content).toContain('OTHER_KEY=foo')
    expect(content).not.toContain(MIM_ACCOUNT_TOKEN_KEY)
  })

  it('handles missing keys.env gracefully on clear', async () => {
    const result = await tools.call('account.clearToken', {}, ctx) as { cleared: boolean }
    expect(result.cleared).toBe(true)
  })

  // ── account.status ──

  it('returns connected: false when no token exists', async () => {
    const result = await tools.call('account.status', {}, ctx) as { connected: boolean }
    expect(result.connected).toBe(false)
  })

  it('returns connected: true when token exists', async () => {
    await tools.call('account.setToken', { token: 'tok_status' }, ctx)

    const result = await tools.call('account.status', {}, ctx) as { connected: boolean }
    expect(result.connected).toBe(true)
  })

  // ── account.validate ──

  it('throws when no token is configured', async () => {
    await expect(
      tools.call('account.validate', {}, ctx),
    ).rejects.toThrow('No account token configured')
  })

  it('calls the validation endpoint and returns the response', async () => {
    await tools.call('account.setToken', { token: 'tok_valid' }, ctx)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        client: { id: 'c1', name: 'ACME Corp' },
        entitlements: ['pkg-a', 'pkg-b'],
      }),
    })

    // Re-register with custom fetch
    tools.unregister('account.validate')
    tools.unregister('account.status')
    tools.unregister('account.setToken')
    tools.unregister('account.clearToken')
    registerAccountTools(tools, () => {}, { home, fetchUrl: mockFetch })

    const result = await tools.call('account.validate', {}, ctx) as {
      client: { id: string; name: string }
      entitlements: string[]
    }

    expect(result.client.name).toBe('ACME Corp')
    expect(result.entitlements).toEqual(['pkg-a', 'pkg-b'])
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/validate'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok_valid' }),
      }),
    )
  })

  it('throws when the validation endpoint returns an error', async () => {
    await tools.call('account.setToken', { token: 'tok_bad' }, ctx)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    tools.unregister('account.validate')
    tools.unregister('account.status')
    tools.unregister('account.setToken')
    tools.unregister('account.clearToken')
    registerAccountTools(tools, () => {}, { home, fetchUrl: mockFetch })

    await expect(
      tools.call('account.validate', {}, ctx),
    ).rejects.toThrow()
  })

  // ── readAccountToken helper ──

  it('readAccountToken returns null when no token', () => {
    expect(readAccountToken(home)).toBeNull()
  })

  it('readAccountToken returns the token value', () => {
    const keysDir = join(home, '.mim')
    mkdirSync(keysDir, { recursive: true })
    writeFileSync(join(keysDir, 'keys.env'), `${MIM_ACCOUNT_TOKEN_KEY}=tok_read\n`)

    expect(readAccountToken(home)).toBe('tok_read')
  })
})
