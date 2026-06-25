import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  getWebReadCacheEntry,
  putWebReadCacheEntry,
  readWebReadCache,
} from './webReadCache.js'

async function withWorkspace<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mim-web-cache-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('web read cache', () => {
  it('persists and retrieves entries by normalized URL', async () => {
    await withWorkspace((workspacePath) => {
      putWebReadCacheEntry(workspacePath, {
        url: 'https://example.com/path#section',
        finalUrl: 'https://example.com/path',
        title: 'Cached Page',
        content: '# Cached Page\n\nBody',
        length: 20,
        sourceDomain: 'example.com',
        createdAt: '2026-06-25T10:00:00.000Z',
      })

      const entry = getWebReadCacheEntry(workspacePath, 'https://example.com/path', {
        now: new Date('2026-06-25T10:10:00.000Z'),
        maxAgeMs: 60 * 60 * 1000,
      })

      expect(entry).toMatchObject({
        title: 'Cached Page',
        content: '# Cached Page\n\nBody',
        sourceDomain: 'example.com',
      })
    })
  })

  it('expires old entries', async () => {
    await withWorkspace((workspacePath) => {
      putWebReadCacheEntry(workspacePath, {
        url: 'https://example.com/old',
        finalUrl: 'https://example.com/old',
        title: 'Old',
        content: 'Old content',
        length: 11,
        createdAt: '2026-06-25T08:00:00.000Z',
      })

      expect(getWebReadCacheEntry(workspacePath, 'https://example.com/old', {
        now: new Date('2026-06-25T10:00:00.000Z'),
        maxAgeMs: 60 * 60 * 1000,
      })).toBeNull()
    })
  })

  it('keeps the newest bounded entries', async () => {
    await withWorkspace((workspacePath) => {
      for (let i = 0; i < 5; i++) {
        putWebReadCacheEntry(workspacePath, {
          url: `https://example.com/${i}`,
          finalUrl: `https://example.com/${i}`,
          title: `Page ${i}`,
          content: `Content ${i}`,
          length: 9,
          createdAt: `2026-06-25T10:0${i}:00.000Z`,
        }, { maxEntries: 3 })
      }

      expect(readWebReadCache(workspacePath).entries.map(entry => entry.url)).toEqual([
        'https://example.com/4',
        'https://example.com/3',
        'https://example.com/2',
      ])
    })
  })
})
