import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  addResearchBrowserDomain,
  isResearchBrowserAllowed,
  normalizeResearchDomainPattern,
  readResearchBrowserSettings,
  recordResearchBrowserSourceRead,
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

  it('persists workspace research browser grants', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-research-settings-'))
    try {
      expect(readResearchBrowserSettings(dir)).toEqual({ enabled: false, allowedDomains: [], sources: [] })

      addResearchBrowserDomain(dir, 'https://DBRegio-Berlin-Brandenburg.de/foo')
      addResearchBrowserDomain(dir, '*.example.org')
      addResearchBrowserDomain(dir, 'dbregio-berlin-brandenburg.de')

      expect(readResearchBrowserSettings(dir)).toMatchObject({
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de', '*.example.org'],
        sources: [
          { domain: 'dbregio-berlin-brandenburg.de', allowed: true, status: 'ready', attentionRequired: false },
          { domain: '*.example.org', allowed: true, status: 'ready', attentionRequired: false },
        ],
      })

      removeResearchBrowserDomain(dir, '*.EXAMPLE.org')
      expect(readResearchBrowserSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de'],
        sources: [
          { domain: 'dbregio-berlin-brandenburg.de', allowed: true, status: 'ready', attentionRequired: false, consecutiveFailures: 0 },
        ],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records source readiness, attention state, and last read metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-research-settings-'))
    try {
      addResearchBrowserDomain(dir, 'example.com')

      recordResearchBrowserSourceRead(dir, {
        domain: 'example.com',
        url: 'https://example.com/report',
        status: 'ok',
        attentionRequired: false,
        source: 'rendered',
        at: '2026-06-25T10:00:00.000Z',
      })

      expect(readResearchBrowserSettings(dir).sources).toEqual([
        {
          domain: 'example.com',
          allowed: true,
          status: 'ready',
          attentionRequired: false,
          lastStatus: 'ok',
          lastSource: 'rendered',
          lastUrl: 'https://example.com/report',
          lastReadAt: '2026-06-25T10:00:00.000Z',
          lastSuccessAt: '2026-06-25T10:00:00.000Z',
          consecutiveFailures: 0,
        },
      ])

      recordResearchBrowserSourceRead(dir, {
        domain: 'example.com',
        url: 'https://example.com/private',
        status: 'login_required',
        attentionRequired: true,
        reason: 'The page is asking for an authenticated session.',
        source: 'research-profile',
        at: '2026-06-25T10:05:00.000Z',
      })

      expect(readResearchBrowserSettings(dir).sources).toEqual([
        {
          domain: 'example.com',
          allowed: true,
          status: 'needs_attention',
          attentionRequired: true,
          lastStatus: 'login_required',
          lastSource: 'research-profile',
          lastUrl: 'https://example.com/private',
          lastReadAt: '2026-06-25T10:05:00.000Z',
          lastSuccessAt: '2026-06-25T10:00:00.000Z',
          lastFailureAt: '2026-06-25T10:05:00.000Z',
          consecutiveFailures: 1,
          reason: 'The page is asking for an authenticated session.',
        },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records unconfigured source attention without granting access', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-research-settings-'))
    try {
      recordResearchBrowserSourceRead(dir, {
        domain: 'stackoverflow.com',
        url: 'https://stackoverflow.com/questions/1',
        status: 'source_not_configured',
        attentionRequired: true,
        reason: 'Add stackoverflow.com to Research Browser sources.',
        source: 'rendered',
        at: '2026-06-25T11:00:00.000Z',
      })

      expect(readResearchBrowserSettings(dir)).toEqual({
        enabled: false,
        allowedDomains: [],
        sources: [
          {
            domain: 'stackoverflow.com',
            allowed: false,
            status: 'not_configured',
            attentionRequired: true,
            lastStatus: 'source_not_configured',
            lastSource: 'rendered',
            lastUrl: 'https://stackoverflow.com/questions/1',
            lastReadAt: '2026-06-25T11:00:00.000Z',
            lastFailureAt: '2026-06-25T11:00:00.000Z',
            consecutiveFailures: 1,
            reason: 'Add stackoverflow.com to Research Browser sources.',
          },
        ],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
