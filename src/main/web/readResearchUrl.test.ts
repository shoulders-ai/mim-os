import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { addResearchBrowserDomain, readResearchBrowserSettings } from './researchSettings.js'
import { classifyRenderedRead, readResearchUrl, type ResearchPageRenderer } from './readResearchUrl.js'

async function withWorkspace<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mim-research-read-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function rendererReturning(html: string, title = 'Research Page'): ResearchPageRenderer {
  return vi.fn(async ({ url }) => ({
    requestedUrl: url,
    finalUrl: `${url}#research`,
    title,
    html,
  }))
}

describe('classifyRenderedRead', () => {
  it('classifies common blocked and weak page states', () => {
    expect(classifyRenderedRead({ title: 'Just a moment...', content: '# stackoverflow.com\n\nPerforming security verification' }))
      .toMatchObject({ status: 'security_verification', attention_required: true })
    expect(classifyRenderedRead({ title: 'Before you continue to Google Maps', content: 'Before you continue to Google' }))
      .toMatchObject({ status: 'consent_required', attention_required: true })
    expect(classifyRenderedRead({ title: 'Sign in', content: 'Log in to continue' }))
      .toMatchObject({ status: 'login_required', attention_required: true })
    expect(classifyRenderedRead({ title: 'Fehler', content: '# Fehler\n\nDa ist etwas schief gelaufen' }))
      .toMatchObject({ status: 'site_error', attention_required: true })
    expect(classifyRenderedRead({ title: 'Empty', content: '' }))
      .toMatchObject({ status: 'empty_capture', attention_required: true })
    expect(classifyRenderedRead({ title: 'Linear', content: 'Loading…' }))
      .toMatchObject({ status: 'partial', attention_required: false })
    expect(classifyRenderedRead({
      title: 'Linear',
      content: 'Loading…',
      capture: {
        status: 'partial',
        confidence: 'low',
        reason: 'Capture budget ended before readiness was certain.',
        signals: { timed_out: true, visible_text_chars: 8 },
      },
    })).toMatchObject({ status: 'partial', attention_required: false })
    expect(classifyRenderedRead({ title: 'Article', content: '# Article\n\nActual research content.' }))
      .toMatchObject({ status: 'ok', attention_required: false })
  })
})

describe('readResearchUrl', () => {
  it('uses the persistent research renderer for an allowed domain', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')
      const render = rendererReturning('<body><h1>Authorized Page</h1><p>Content from logged-in session.</p></body>')

      const result = await readResearchUrl({
        url: 'https://example.com/private',
        max_chars: 100_000,
      }, {
        workspacePath,
        render,
        now: () => new Date('2026-06-25T13:00:00.000Z'),
      })

      expect(result.source).toBe('research-profile')
      expect(result.status).toBe('ok')
      expect(result.attention_required).toBe(false)
      expect(result.allowed_domain).toBe('example.com')
      expect(result.final_url).toBe('https://example.com/private#research')
      expect(result.content).toContain('# Authorized Page')
      expect(render).toHaveBeenCalledWith({
        url: 'https://example.com/private',
        timeoutMs: 30_000,
      })
      expect(readResearchBrowserSettings(workspacePath).sources).toEqual([
        {
          domain: 'example.com',
          allowed: true,
          status: 'ready',
          attentionRequired: false,
          lastStatus: 'ok',
          lastSource: 'research-profile',
          lastUrl: 'https://example.com/private',
          lastReadAt: '2026-06-25T13:00:00.000Z',
          lastSuccessAt: '2026-06-25T13:00:00.000Z',
          consecutiveFailures: 0,
        },
      ])
    })
  })

  it('refuses unlisted domains before opening the research profile', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'allowed.example')
      const render = rendererReturning('<body>Never reached</body>')

      await expect(readResearchUrl({ url: 'https://blocked.example/page' }, { workspacePath, render }))
        .rejects.toThrow('Research browser is not allowed for blocked.example')
      expect(render).not.toHaveBeenCalled()
    })
  })

  it('returns explicit attention status for blocked pages instead of pretending success', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'stackoverflow.com')

      const result = await readResearchUrl({ url: 'https://stackoverflow.com/questions/1' }, {
        workspacePath,
        render: rendererReturning('<body><h1>stackoverflow.com</h1><h2>Performing security verification</h2></body>', 'Just a moment...'),
        now: () => new Date('2026-06-25T13:05:00.000Z'),
      })

      expect(result.status).toBe('security_verification')
      expect(result.attention_required).toBe(true)
      expect(result.reason).toContain('security verification')
      expect(readResearchBrowserSettings(workspacePath).sources[0]).toMatchObject({
        domain: 'stackoverflow.com',
        allowed: true,
        status: 'needs_attention',
        attentionRequired: true,
        lastStatus: 'security_verification',
        lastSource: 'research-profile',
        lastUrl: 'https://stackoverflow.com/questions/1',
        lastReadAt: '2026-06-25T13:05:00.000Z',
        lastFailureAt: '2026-06-25T13:05:00.000Z',
        consecutiveFailures: 1,
      })
    })
  })

  it('reports unavailable research backend clearly', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')

      await expect(readResearchUrl({ url: 'https://example.com' }, { workspacePath }))
        .rejects.toThrow('web.readResearch is only available in the Electron desktop runtime')
    })
  })
})
