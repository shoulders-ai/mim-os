import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { addBrowserSessionDomain, readBrowserSessionSettings } from './browserSessionSettings.js'
import { readBrowserSessionUrl, type BrowserSessionPageRenderer } from './readBrowserSessionUrl.js'

async function withWorkspace<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mim-browser-session-read-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function rendererReturning(html: string, title = 'Website Access Page'): BrowserSessionPageRenderer {
  return vi.fn(async ({ url }) => ({
    requestedUrl: url,
    finalUrl: `${url}#browser-session`,
    title,
    html,
  }))
}

describe('readBrowserSessionUrl', () => {
  it('uses the website access renderer for an allowed domain without classifying content', async () => {
    await withWorkspace(async (workspacePath) => {
      addBrowserSessionDomain(workspacePath, 'example.com')
      const render = rendererReturning('<body><h1>Authorized Page</h1><p>Content from logged-in session.</p></body>')

      const result = await readBrowserSessionUrl({
        url: 'https://example.com/private',
        max_chars: 100_000,
      }, {
        workspacePath,
        render,
      })

      expect(result.source).toBe('rendered-stateful')
      expect(result.allowed_domain).toBe('example.com')
      expect(result.final_url).toBe('https://example.com/private#browser-session')
      expect(result.content).toContain('# Authorized Page')
      expect(result).not.toHaveProperty('status')
      expect(result).not.toHaveProperty('attention_required')
      expect(readBrowserSessionSettings(workspacePath)).toEqual({
        enabled: true,
        allowedDomains: ['example.com'],
      })
      expect(render).toHaveBeenCalledWith({
        url: 'https://example.com/private',
        timeoutMs: 30_000,
        allowedDomains: ['example.com'],
      })
    })
  })

  it('refuses unlisted domains before opening the website access profile', async () => {
    await withWorkspace(async (workspacePath) => {
      addBrowserSessionDomain(workspacePath, 'allowed.example')
      const render = rendererReturning('<body>Never reached</body>')

      await expect(readBrowserSessionUrl({ url: 'https://blocked.example/page' }, { workspacePath, render }))
        .rejects.toThrow('Website access is not approved for blocked.example')
      expect(render).not.toHaveBeenCalled()
    })
  })

  it('reports unavailable website access backend clearly', async () => {
    await withWorkspace(async (workspacePath) => {
      addBrowserSessionDomain(workspacePath, 'example.com')

      await expect(readBrowserSessionUrl({ url: 'https://example.com' }, { workspacePath }))
        .rejects.toThrow('Stateful web reads are only available in the Electron desktop runtime')
    })
  })
})
