import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerWebTools } from './web.js'

describe('web tools', () => {
  const ctx = { actor: 'user' as const }

  it('registers one web.read workhorse and removes legacy reader tools', async () => {
    const tools = createToolRegistry(createTraceLog())
    registerWebTools(tools)

    expect(tools.get('web.read')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        stateful: { type: 'boolean' },
        max_chars: { type: 'number' },
        start_from_char: { type: 'number' },
        extract_links: { type: 'boolean' },
        extract_images: { type: 'boolean' },
        timeout_ms: { type: 'number' },
      },
    })
    expect(tools.get('web.readAuto')).toBeUndefined()
    expect(tools.get('web.readRendered')).toBeUndefined()
    expect(tools.get('web.readResearch')).toBeUndefined()
  })

  it('routes web.read to the stateless renderer by default', async () => {
    const tools = createToolRegistry(createTraceLog())
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 405,
      headers: new Headers({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    const renderRenderedPage = vi.fn(async ({ url }: { url: string }) => ({
      requestedUrl: url,
      finalUrl: `${url}#rendered`,
      title: 'Rendered',
      html: '<body><h1>Rendered Content</h1><p>Hydrated page body.</p></body>',
    }))
    const renderResearchPage = vi.fn(async ({ url }: { url: string }) => ({
      requestedUrl: url,
      finalUrl: `${url}#research`,
      title: 'Research',
      html: '<body>Should not be used</body>',
    }))

    registerWebTools(tools, { fetch, renderRenderedPage, renderResearchPage })

    const result = await tools.call('web.read', {
      url: 'https://example.com',
      max_chars: 100_000,
      timeout_ms: 12_345,
    }, ctx) as Record<string, unknown>

    expect(result).toMatchObject({
      source: 'rendered',
      final_url: 'https://example.com#rendered',
      title: 'Rendered',
    })
    expect(String(result.content)).toContain('# Rendered Content')
    expect(renderRenderedPage).toHaveBeenCalledWith({
      url: 'https://example.com',
      timeoutMs: 12_345,
    })
    expect(renderResearchPage).not.toHaveBeenCalled()
  })

  it('rejects stateful web.read for an ungranted domain before opening the Research Browser renderer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-web-tools-'))
    try {
      const tools = createToolRegistry(createTraceLog())
      tools.setWorkspacePath(dir)
      const fetch = vi.fn(async () => ({
        ok: false,
        status: 405,
        headers: new Headers({}),
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0),
      }))
      const renderResearchPage = vi.fn(async ({ url }: { url: string }) => ({
        requestedUrl: url,
        finalUrl: `${url}#research`,
        title: 'Research',
        html: '<body>Should not be used</body>',
      }))

      registerWebTools(tools, { fetch, renderResearchPage })
      await tools.call('web.research.allowDomain', { domain: 'allowed.example' }, ctx)

      await expect(tools.call('web.read', {
        url: 'https://blocked.example/private',
        stateful: true,
      }, ctx)).rejects.toThrow('Research Browser is not allowed for blocked.example. Add this domain in Settings > Connections first.')

      expect(renderResearchPage).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps Research Browser domain management as kernel-only setup tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-web-tools-'))
    try {
      const tools = createToolRegistry(createTraceLog())
      tools.setWorkspacePath(dir)
      const openResearchBrowser = vi.fn(async () => ({ opened: true, partition: 'persist:mim-research' }))
      const clearResearchBrowserProfile = vi.fn(async () => ({ cleared: true, partition: 'persist:mim-research' }))

      registerWebTools(tools, {
        openResearchBrowser,
        clearResearchBrowserProfile,
      })

      const allowed = await tools.call('web.research.allowDomain', { domain: 'https://example.com/path' }, ctx)
      expect(allowed).toEqual({
        enabled: true,
        allowedDomains: ['example.com'],
      })

      const status = await tools.call('web.research.status', {}, ctx)
      expect(status).toEqual({
        enabled: true,
        allowedDomains: ['example.com'],
        profile_available: true,
      })

      expect(await tools.call('web.research.open', { url: 'https://example.com/login' }, ctx))
        .toEqual({ opened: true, partition: 'persist:mim-research' })
      expect(openResearchBrowser).toHaveBeenCalledWith({ url: 'https://example.com/login' })
      expect(await tools.call('web.research.clearProfile', {}, ctx))
        .toEqual({ cleared: true, partition: 'persist:mim-research' })
      expect(clearResearchBrowserProfile).toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports non-PDF web reads as unavailable without a desktop renderer', async () => {
    const tools = createToolRegistry(createTraceLog())
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 405,
      headers: new Headers({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    registerWebTools(tools, { fetch })

    await expect(tools.call('web.read', { url: 'https://example.com' }, ctx))
      .rejects.toThrow('Rendered web reads are only available in the Electron desktop runtime')
  })
})
