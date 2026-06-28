import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  addBrowserSessionDomain,
  isBrowserSessionAllowed,
  normalizeBrowserSessionDomainPattern,
  readBrowserSessionSettings,
  removeBrowserSessionDomain,
} from './browserSessionSettings.js'

describe('website access settings', () => {
  it('normalizes exact and wildcard domain grants', () => {
    expect(normalizeBrowserSessionDomainPattern('https://StackOverflow.com/questions/1')).toBe('stackoverflow.com')
    expect(normalizeBrowserSessionDomainPattern(' *.Example.ORG ')).toBe('*.example.org')
    expect(normalizeBrowserSessionDomainPattern('https://sub.example.org/path?q=1')).toBe('sub.example.org')
  })

  it('matches exact domains and wildcard subdomains without matching suffix attacks', () => {
    const allowedDomains = ['stackoverflow.com', '*.example.org']

    expect(isBrowserSessionAllowed('https://stackoverflow.com/questions/1', allowedDomains)).toMatchObject({
      allowed: true,
      matchedDomain: 'stackoverflow.com',
    })
    expect(isBrowserSessionAllowed('https://docs.example.org/page', allowedDomains)).toMatchObject({
      allowed: true,
      matchedDomain: '*.example.org',
    })
    expect(isBrowserSessionAllowed('https://example.org/page', allowedDomains)).toMatchObject({
      allowed: true,
      matchedDomain: '*.example.org',
    })
    expect(isBrowserSessionAllowed('https://notexample.org/page', allowedDomains).allowed).toBe(false)
    expect(isBrowserSessionAllowed('https://stackoverflow.com.evil.test/page', allowedDomains).allowed).toBe(false)
  })

  it('persists workspace browser session grants without source health state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-browser-session-settings-'))
    try {
      expect(readBrowserSessionSettings(dir)).toEqual({ enabled: false, allowedDomains: [] })

      addBrowserSessionDomain(dir, 'https://DBRegio-Berlin-Brandenburg.de/foo')
      addBrowserSessionDomain(dir, '*.example.org')
      addBrowserSessionDomain(dir, 'dbregio-berlin-brandenburg.de')

      expect(readBrowserSessionSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de', '*.example.org'],
      })

      removeBrowserSessionDomain(dir, '*.EXAMPLE.org')
      expect(readBrowserSessionSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes current state under the browserSession key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-browser-session-settings-'))
    try {
      mkdirSync(join(dir, '.mim'), { recursive: true })
      writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify({
        browserSession: {
          enabled: true,
          allowedDomains: ['example.com'],
        },
      }))

      expect(readBrowserSessionSettings(dir)).toEqual({
        enabled: true,
        allowedDomains: ['example.com'],
      })

      addBrowserSessionDomain(dir, 'maps.google.com')
      const raw = JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8')) as Record<string, any>
      expect(raw.browserSession).toEqual({
        enabled: true,
        allowedDomains: ['example.com', 'maps.google.com'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

})
