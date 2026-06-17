import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { join } from 'path'
import {
  registryMirrorDir,
  packageMirrorDir,
  DEFAULT_CACHE_ROOT,
} from '@main/packages/cacheLayout.js'
import { userHomeDir } from '@main/platform.js'

function shortHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 12)
}

describe('cacheLayout', () => {
  const cacheRoot = '/tmp/test-cache'

  describe('registryMirrorDir', () => {
    it('returns <cacheRoot>/registry/<sha256(url)[0..12]>/repo', () => {
      const url = 'https://github.com/shoulders-ai/mim-registry.git'
      const hash = shortHash(url)
      expect(registryMirrorDir(url, cacheRoot)).toBe(
        join(cacheRoot, 'registry', hash, 'repo'),
      )
    })

    it('different URLs produce different paths', () => {
      const a = registryMirrorDir('https://a.com/reg.git', cacheRoot)
      const b = registryMirrorDir('https://b.com/reg.git', cacheRoot)
      expect(a).not.toBe(b)
    })

    it('uses DEFAULT_CACHE_ROOT when no cacheRoot is given', () => {
      const url = 'https://github.com/shoulders-ai/mim-registry.git'
      const hash = shortHash(url)
      expect(registryMirrorDir(url)).toBe(
        join(DEFAULT_CACHE_ROOT, 'registry', hash, 'repo'),
      )
    })
  })

  describe('packageMirrorDir', () => {
    it('returns <cacheRoot>/package-mirrors/<sha256(url)[0..12]>/repo', () => {
      const url = 'https://github.com/shoulders-ai/mim-github-monitor'
      const hash = shortHash(url)
      expect(packageMirrorDir(url, cacheRoot)).toBe(
        join(cacheRoot, 'package-mirrors', hash, 'repo'),
      )
    })

    it('different URLs produce different paths', () => {
      const a = packageMirrorDir('https://a.com/pkg.git', cacheRoot)
      const b = packageMirrorDir('https://b.com/pkg.git', cacheRoot)
      expect(a).not.toBe(b)
    })

    it('uses DEFAULT_CACHE_ROOT when no cacheRoot is given', () => {
      const url = 'https://github.com/shoulders-ai/mim-github-monitor'
      const hash = shortHash(url)
      expect(packageMirrorDir(url)).toBe(
        join(DEFAULT_CACHE_ROOT, 'package-mirrors', hash, 'repo'),
      )
    })
  })

  describe('DEFAULT_CACHE_ROOT', () => {
    it('is ~/.mim/cache', () => {
      expect(DEFAULT_CACHE_ROOT).toBe(join(userHomeDir(), '.mim', 'cache'))
    })
  })

  describe('hash consistency with resourceModel.mirrorDirFor', () => {
    it('uses the same sha256(url)[0..12] hashing as resourceModel', () => {
      const url = 'https://github.com/shoulders-ai/mim-github-monitor'
      const hash = shortHash(url)
      const dir = packageMirrorDir(url, cacheRoot)
      expect(dir).toContain(hash)
    })
  })
})
