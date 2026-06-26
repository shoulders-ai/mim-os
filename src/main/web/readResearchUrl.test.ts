import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { addResearchBrowserDomain, readResearchBrowserSettings } from './researchSettings.js'
import { readResearchUrl, type ResearchPageRenderer } from './readResearchUrl.js'

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

describe('readResearchUrl', () => {
  it('uses the persistent research renderer for an allowed domain without classifying content', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')
      const render = rendererReturning('<body><h1>Authorized Page</h1><p>Content from logged-in session.</p></body>')

      const result = await readResearchUrl({
        url: 'https://example.com/private',
        max_chars: 100_000,
      }, {
        workspacePath,
        render,
      })

      expect(result.source).toBe('rendered-stateful')
      expect(result.allowed_domain).toBe('example.com')
      expect(result.final_url).toBe('https://example.com/private#research')
      expect(result.content).toContain('# Authorized Page')
      expect(result).not.toHaveProperty('status')
      expect(result).not.toHaveProperty('attention_required')
      expect(readResearchBrowserSettings(workspacePath)).toEqual({
        enabled: true,
        allowedDomains: ['example.com'],
      })
      expect(render).toHaveBeenCalledWith({
        url: 'https://example.com/private',
        timeoutMs: 30_000,
      })
    })
  })

  it('refuses unlisted domains before opening the research profile', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'allowed.example')
      const render = rendererReturning('<body>Never reached</body>')

      await expect(readResearchUrl({ url: 'https://blocked.example/page' }, { workspacePath, render }))
        .rejects.toThrow('Research Browser is not allowed for blocked.example')
      expect(render).not.toHaveBeenCalled()
    })
  })

  it('reports unavailable research backend clearly', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')

      await expect(readResearchUrl({ url: 'https://example.com' }, { workspacePath }))
        .rejects.toThrow('Stateful web reads are only available in the Electron desktop runtime')
    })
  })
})
