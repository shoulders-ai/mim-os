import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  addResearchBrowserDomain,
  isResearchBrowserAllowed,
  normalizeResearchDomainPattern,
  readResearchBrowserSettings,
  removeResearchBrowserDomain,
} from './researchSettings.js'

describe('research browser settings', () => {
  it('normalizes exact and wildcard domain grants', () => {
    expect(normalizeResearchDomainPattern('https://StackOverflow.com/questions/1')).toBe('stackoverflow.com')
    expect(normalizeResearchDomainPattern(' *.Example.ORG ')).toBe('*.example.org')
    expect(normalizeResearchDomainPattern('https://sub.example.org/path?q=1')).toBe('sub.example.org')
  })

  it('matches exact domains and wildcard subdomains without matching suffix attacks', () => {
    const allowedDomains = ['stackoverflow.com', '*.example.org']

    expect(isResearchBrowserAllowed('https://stackoverflow.com/questions/1', allowedDomains)).toMatchObject({
      allowed: true,
      matchedDomain: 'stackoverflow.com',
    })
    expect(isResearchBrowserAllowed('https://docs.example.org/page', allowedDomains)).toMatchObject({
      allowed: true,
      matchedDomain: '*.example.org',
    })
    expect(isResearchBrowserAllowed('https://example.org/page', allowedDomains)).toMatchObject({
      allowed: true,
      matchedDomain: '*.example.org',
    })
    expect(isResearchBrowserAllowed('https://notexample.org/page', allowedDomains).allowed).toBe(false)
    expect(isResearchBrowserAllowed('https://stackoverflow.com.evil.test/page', allowedDomains).allowed).toBe(false)
  })

  it('persists workspace research browser grants without source health state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-research-settings-'))
    try {
      expect(readResearchBrowserSettings(dir)).toEqual({ enabled: false, allowedDomains: [] })

      addResearchBrowserDomain(dir, 'https://DBRegio-Berlin-Brandenburg.de/foo')
      addResearchBrowserDomain(dir, '*.example.org')
      addResearchBrowserDomain(dir, 'dbregio-berlin-brandenburg.de')

      expect(readResearchBrowserSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de', '*.example.org'],
      })

      removeResearchBrowserDomain(dir, '*.EXAMPLE.org')
      expect(readResearchBrowserSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops legacy sources on the next settings write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-research-settings-'))
    try {
      mkdirSync(join(dir, '.mim'), { recursive: true })
      writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify({
        researchBrowser: {
          enabled: true,
          allowedDomains: ['example.com'],
          sources: [
            {
              domain: 'example.com',
              status: 'needs_attention',
              attentionRequired: true,
              reason: 'legacy classifier state',
            },
          ],
        },
      }))

      expect(readResearchBrowserSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['example.com'],
      })

      addResearchBrowserDomain(dir, 'maps.google.com')
      const raw = JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8')) as Record<string, any>
      expect(raw.researchBrowser).toEqual({
        enabled: true,
        allowedDomains: ['example.com', 'maps.google.com'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
