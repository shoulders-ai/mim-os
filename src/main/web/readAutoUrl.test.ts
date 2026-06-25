import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { addResearchBrowserDomain, readResearchBrowserSettings } from './researchSettings.js'
import { readAutoUrl, type AutoPageRenderer } from './readAutoUrl.js'

async function withWorkspace<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mim-auto-read-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function rendererReturning(html: string, title = 'Rendered Page'): AutoPageRenderer {
  return vi.fn(async ({ url }) => ({
    requestedUrl: url,
    finalUrl: `${url}#rendered`,
    title,
    html,
  }))
}

describe('readAutoUrl', () => {
  it('uses the stateless rendered reader when the captured page is readable', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')
      const renderRendered = rendererReturning('<body><h1>Public Report</h1><p>Readable content.</p></body>')
      const renderResearch = rendererReturning('<body><h1>Private Report</h1></body>')

      const result = await readAutoUrl({
        url: 'https://example.com/report',
        max_chars: 100_000,
      }, {
        workspacePath,
        renderRendered,
        renderResearch,
      })

      expect(result).toMatchObject({
        source: 'rendered',
        status: 'ok',
        attention_required: false,
        final_url: 'https://example.com/report#rendered',
      })
      expect(result.content).toContain('# Public Report')
      expect(renderRendered).toHaveBeenCalledOnce()
      expect(renderResearch).not.toHaveBeenCalled()
      expect(result.attempts).toEqual([
        expect.objectContaining({ source: 'rendered', status: 'ok', attention_required: false }),
      ])
    })
  })

  it('stores successful full reads and falls back to cache on a later blocked read', async () => {
    await withWorkspace(async (workspacePath) => {
      const firstRender = rendererReturning('<body><h1>Live Report</h1><p>Fresh content.</p></body>')

      const first = await readAutoUrl({
        url: 'https://example.com/report',
        max_chars: 100_000,
      }, {
        workspacePath,
        renderRendered: firstRender,
        now: () => new Date('2026-06-25T14:00:00.000Z'),
      })
      expect(first.source).toBe('rendered')

      const secondRender = rendererReturning(
        '<body><h1>Sign in</h1><p>Log in to continue.</p></body>',
        'Sign in',
      )
      const second = await readAutoUrl({
        url: 'https://example.com/report',
        max_chars: 100_000,
      }, {
        workspacePath,
        renderRendered: secondRender,
        now: () => new Date('2026-06-25T14:10:00.000Z'),
      })

      expect(second).toMatchObject({
        source: 'cache',
        status: 'ok',
        attention_required: false,
        cache: {
          hit: true,
          cached_at: '2026-06-25T14:00:00.000Z',
          reason: 'Used cached content after live read returned login_required.',
        },
      })
      expect(second.content).toContain('# Live Report')
      expect(second.attempts).toEqual([
        expect.objectContaining({ source: 'rendered', status: 'login_required', attention_required: true }),
        expect.objectContaining({ source: 'cache', status: 'ok', attention_required: false }),
      ])
    })
  })

  it('returns partial evidence for SPA loading-only captures instead of forcing setup', async () => {
    await withWorkspace(async (workspacePath) => {
      const renderRendered = rendererReturning('<body><div id="root">Loading…</div></body>', 'Linear')

      const result = await readAutoUrl({
        url: 'https://linear.app/shoulders/team/SHO/active',
      }, {
        workspacePath,
        renderRendered,
        now: () => new Date('2026-06-25T15:00:00.000Z'),
      })

      expect(result).toMatchObject({
        source: 'rendered',
        status: 'partial',
        attention_required: false,
        source_domain: 'linear.app',
      })
      expect(result.reason).toContain('little readable content')
      expect(result.attempts).toEqual([
        expect.objectContaining({ source: 'rendered', status: 'partial', attention_required: false }),
      ])
      expect(readResearchBrowserSettings(workspacePath).sources).toEqual([])
    })
  })

  it('falls back to the research profile when a configured source shows a blocker', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'maps.google.com')
      const renderRendered = rendererReturning(
        '<body><h1>Before you continue to Google Maps</h1><p>We value your privacy.</p></body>',
        'Before you continue to Google Maps',
      )
      const renderResearch = rendererReturning(
        '<body><h1>Station coffee shops</h1><p>Open now near Berlin Ostkreuz.</p></body>',
        'Station coffee shops',
      )

      const result = await readAutoUrl({
        url: 'https://maps.google.com/search/coffee',
        timeout_ms: 12_000,
      }, {
        workspacePath,
        renderRendered,
        renderResearch,
        now: () => new Date('2026-06-25T12:00:00.000Z'),
      })

      expect(result).toMatchObject({
        source: 'research-profile',
        allowed_domain: 'maps.google.com',
        status: 'ok',
        attention_required: false,
        final_url: 'https://maps.google.com/search/coffee#rendered',
      })
      expect(result.content).toContain('# Station coffee shops')
      expect(renderRendered).toHaveBeenCalledWith({
        url: 'https://maps.google.com/search/coffee',
        timeoutMs: 12_000,
      })
      expect(renderResearch).toHaveBeenCalledWith({
        url: 'https://maps.google.com/search/coffee',
        timeoutMs: 12_000,
      })
      expect(result.attempts).toEqual([
        expect.objectContaining({ source: 'rendered', status: 'consent_required', attention_required: true }),
        expect.objectContaining({ source: 'research-profile', status: 'ok', attention_required: false }),
      ])
      expect(readResearchBrowserSettings(workspacePath).sources).toEqual([
        {
          domain: 'maps.google.com',
          allowed: true,
          status: 'ready',
          attentionRequired: false,
          lastStatus: 'ok',
          lastSource: 'research-profile',
          lastUrl: 'https://maps.google.com/search/coffee',
          lastReadAt: '2026-06-25T12:00:00.000Z',
          lastSuccessAt: '2026-06-25T12:00:00.000Z',
          consecutiveFailures: 0,
        },
      ])
    })
  })

  it('returns a source setup attention state when a blocker belongs to an unconfigured domain', async () => {
    await withWorkspace(async (workspacePath) => {
      const renderRendered = rendererReturning(
        '<body><h1>Just a moment...</h1><p>Performing security verification.</p></body>',
        'Just a moment...',
      )
      const renderResearch = rendererReturning('<body><h1>Never reached</h1></body>')

      const result = await readAutoUrl({
        url: 'https://stackoverflow.com/questions/1',
      }, {
        workspacePath,
        renderRendered,
        renderResearch,
        now: () => new Date('2026-06-25T12:05:00.000Z'),
      })

      expect(result).toMatchObject({
        source: 'rendered',
        status: 'source_not_configured',
        blocked_status: 'security_verification',
        attention_required: true,
        source_domain: 'stackoverflow.com',
        setup_url: 'https://stackoverflow.com',
      })
      expect(result.reason).toContain('stackoverflow.com')
      expect(result.reason).toContain('Research Browser')
      expect(result.content).toContain('Performing security verification')
      expect(renderResearch).not.toHaveBeenCalled()
      expect(readResearchBrowserSettings(workspacePath).sources).toEqual([
        {
          domain: 'stackoverflow.com',
          allowed: false,
          status: 'not_configured',
          attentionRequired: true,
          lastStatus: 'source_not_configured',
          lastSource: 'rendered',
          lastUrl: 'https://stackoverflow.com/questions/1',
          lastReadAt: '2026-06-25T12:05:00.000Z',
          lastFailureAt: '2026-06-25T12:05:00.000Z',
          consecutiveFailures: 1,
          reason: 'The stateless render reached security_verification. Add stackoverflow.com to Research Browser sources so the agent can use the persistent browser profile.',
        },
      ])
    })
  })

  it('uses the research profile when stateless rendering fails for a configured source', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, '*.example.com')
      const renderRendered = vi.fn(async () => {
        throw new Error('Execution context was destroyed')
      })
      const renderResearch = rendererReturning('<body><h1>Hydrated after retry</h1><p>Useful content.</p></body>')

      const result = await readAutoUrl({
        url: 'https://app.example.com/dashboard',
      }, {
        workspacePath,
        renderRendered,
        renderResearch,
      })

      expect(result).toMatchObject({
        source: 'research-profile',
        allowed_domain: '*.example.com',
        status: 'ok',
        attention_required: false,
      })
      expect(result.content).toContain('# Hydrated after retry')
      expect(result.attempts).toEqual([
        expect.objectContaining({ source: 'rendered', status: 'render_failed', attention_required: true }),
        expect.objectContaining({ source: 'research-profile', status: 'ok', attention_required: false }),
      ])
    })
  })

  it('records one failure when the research fallback also needs attention', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')
      const renderRendered = rendererReturning(
        '<body><h1>Sign in</h1><p>Log in to continue.</p></body>',
        'Sign in',
      )
      const renderResearch = rendererReturning(
        '<body><h1>Just a moment...</h1><p>Performing security verification.</p></body>',
        'Just a moment...',
      )

      const result = await readAutoUrl({
        url: 'https://example.com/private',
      }, {
        workspacePath,
        renderRendered,
        renderResearch,
        now: () => new Date('2026-06-25T12:10:00.000Z'),
      })

      expect(result).toMatchObject({
        source: 'research-profile',
        status: 'security_verification',
        attention_required: true,
      })
      expect(readResearchBrowserSettings(workspacePath).sources[0]).toMatchObject({
        domain: 'example.com',
        status: 'needs_attention',
        lastStatus: 'security_verification',
        consecutiveFailures: 1,
        lastFailureAt: '2026-06-25T12:10:00.000Z',
      })
    })
  })

  it('reports a profile availability attention state when the source is configured but no research renderer exists', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')
      const renderRendered = rendererReturning(
        '<body><h1>Sign in</h1><p>Log in to continue.</p></body>',
        'Sign in',
      )

      const result = await readAutoUrl({
        url: 'https://example.com/private',
      }, {
        workspacePath,
        renderRendered,
      })

      expect(result).toMatchObject({
        source: 'rendered',
        status: 'research_profile_unavailable',
        blocked_status: 'login_required',
        attention_required: true,
      })
      expect(result.reason).toContain('Electron desktop runtime')
    })
  })
})
