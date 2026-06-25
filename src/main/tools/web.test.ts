import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerWebTools } from './web.js'

describe('web tools', () => {
  const ctx = { actor: 'user' as const }

  it('registers web.readAuto with rendered-to-research fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-web-tools-'))
    try {
      const tools = createToolRegistry(createTraceLog())
      tools.setWorkspacePath(dir)
      const renderRenderedPage = vi.fn(async ({ url }: { url: string }) => ({
        requestedUrl: url,
        finalUrl: `${url}#rendered`,
        title: 'Before you continue to Google Maps',
        html: '<body><h1>Before you continue to Google Maps</h1><p>We value your privacy.</p></body>',
      }))
      const renderResearchPage = vi.fn(async ({ url }: { url: string }) => ({
        requestedUrl: url,
        finalUrl: `${url}#research`,
        title: 'Research',
        html: '<body><h1>Real map result</h1><p>Useful source content.</p></body>',
      }))

      registerWebTools(tools, { renderRenderedPage, renderResearchPage })

      expect(tools.get('web.readAuto')?.inputSchema).toMatchObject({
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          max_chars: { type: 'number' },
          start_from_char: { type: 'number' },
          extract_links: { type: 'boolean' },
          extract_images: { type: 'boolean' },
          timeout_ms: { type: 'number' },
          prefer_research: { type: 'boolean' },
        },
      })

      await tools.call('web.research.allowDomain', { domain: 'maps.google.com' }, ctx)
      const result = await tools.call('web.readAuto', {
        url: 'https://maps.google.com/search/coffee',
        timeout_ms: 12_000,
      }, ctx) as Record<string, unknown>

      expect(result).toMatchObject({
        source: 'research-profile',
        allowed_domain: 'maps.google.com',
        status: 'ok',
        attention_required: false,
        final_url: 'https://maps.google.com/search/coffee#research',
      })
      expect(String(result.content)).toContain('# Real map result')
      expect(renderRenderedPage).toHaveBeenCalledWith({
        url: 'https://maps.google.com/search/coffee',
        timeoutMs: 12_000,
      })
      expect(renderResearchPage).toHaveBeenCalledWith({
        url: 'https://maps.google.com/search/coffee',
        timeoutMs: 12_000,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('registers web.readRendered with the rendered reader contract', async () => {
    const tools = createToolRegistry(createTraceLog())
    const render = vi.fn(async ({ url }: { url: string }) => ({
      requestedUrl: url,
      finalUrl: `${url}#done`,
      title: 'Rendered',
      html: '<body><h1>Rendered Content</h1></body>',
    }))

    registerWebTools(tools, { renderRenderedPage: render })

    const def = tools.get('web.readRendered')
    expect(def?.inputSchema).toMatchObject({
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        max_chars: { type: 'number' },
        start_from_char: { type: 'number' },
        extract_links: { type: 'boolean' },
        extract_images: { type: 'boolean' },
        timeout_ms: { type: 'number' },
      },
    })

    const result = await tools.call('web.readRendered', {
      url: 'https://example.com',
      max_chars: 100_000,
      extract_links: true,
      extract_images: true,
      timeout_ms: 12_345,
    }, ctx) as {
      final_url: string
      title: string
      content: string
      truncated: boolean
    }

    expect(result.final_url).toBe('https://example.com#done')
    expect(result.title).toBe('Rendered')
    expect(result.content).toContain('# Rendered Content')
    expect(result.truncated).toBe(false)
    expect(render).toHaveBeenCalledWith({
      url: 'https://example.com',
      timeoutMs: 12_345,
    })
  })

  it('reports a clear unavailable error when no rendered backend is registered', async () => {
    const tools = createToolRegistry(createTraceLog())
    registerWebTools(tools)

    await expect(tools.call('web.readRendered', { url: 'https://example.com' }, ctx))
      .rejects.toThrow('web.readRendered is only available in the Electron desktop runtime')
  })

  it('registers research browser domain management and read tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-web-tools-'))
    try {
      const tools = createToolRegistry(createTraceLog())
      tools.setWorkspacePath(dir)
      const renderResearchPage = vi.fn(async ({ url }: { url: string }) => ({
        requestedUrl: url,
        finalUrl: `${url}#research`,
        title: 'Research',
        html: '<body><h1>Authorized Research</h1><p>Logged-in content.</p></body>',
      }))
      const openResearchBrowser = vi.fn(async () => ({ opened: true, partition: 'persist:mim-research' }))
      const clearResearchBrowserProfile = vi.fn(async () => ({ cleared: true, partition: 'persist:mim-research' }))

      registerWebTools(tools, {
        renderResearchPage,
        openResearchBrowser,
        clearResearchBrowserProfile,
      })

      expect(tools.get('web.readResearch')?.inputSchema).toMatchObject({
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string' },
          max_chars: { type: 'number' },
          start_from_char: { type: 'number' },
          extract_links: { type: 'boolean' },
          extract_images: { type: 'boolean' },
          timeout_ms: { type: 'number' },
        },
      })

      const allowed = await tools.call('web.research.allowDomain', { domain: 'https://example.com/path' }, ctx)
      expect(allowed).toMatchObject({
        enabled: true,
        allowedDomains: ['example.com'],
        sources: [
          { domain: 'example.com', allowed: true, status: 'ready', attentionRequired: false },
        ],
      })

      const status = await tools.call('web.research.status', {}, ctx)
      expect(status).toMatchObject({
        enabled: true,
        allowedDomains: ['example.com'],
        sources: [
          { domain: 'example.com', allowed: true, status: 'ready', attentionRequired: false },
        ],
        profile_available: true,
      })

      const result = await tools.call('web.readResearch', {
        url: 'https://example.com/private',
        timeout_ms: 12_000,
      }, ctx) as Record<string, unknown>
      expect(result).toMatchObject({
        source: 'research-profile',
        allowed_domain: 'example.com',
        status: 'ok',
        attention_required: false,
        final_url: 'https://example.com/private#research',
      })
      expect(String(result.content)).toContain('# Authorized Research')
      expect(renderResearchPage).toHaveBeenCalledWith({
        url: 'https://example.com/private',
        timeoutMs: 12_000,
      })
      expect(await tools.call('web.research.status', {}, ctx)).toMatchObject({
        sources: [
          {
            domain: 'example.com',
            status: 'ready',
            lastStatus: 'ok',
            lastSource: 'research-profile',
            lastUrl: 'https://example.com/private',
          },
        ],
      })

      await expect(tools.call('web.readResearch', { url: 'https://other.example/private' }, ctx))
        .rejects.toThrow('Research browser is not allowed for other.example')

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

  it('reports research browser runtime features as unavailable without Electron deps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-web-tools-'))
    try {
      const tools = createToolRegistry(createTraceLog())
      tools.setWorkspacePath(dir)
      registerWebTools(tools)

      await tools.call('web.research.allowDomain', { domain: 'example.com' }, ctx)
      await expect(tools.call('web.readResearch', { url: 'https://example.com' }, ctx))
        .rejects.toThrow('web.readResearch is only available in the Electron desktop runtime')
      await expect(tools.call('web.research.open', { url: 'https://example.com' }, ctx))
        .rejects.toThrow('Research browser setup is only available in the Electron desktop runtime')
      await expect(tools.call('web.research.clearProfile', {}, ctx))
        .rejects.toThrow('Research browser profile clearing is only available in the Electron desktop runtime')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
