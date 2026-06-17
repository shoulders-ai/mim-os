import { describe, expect, it } from 'vitest'
import { fuzzyScore, rankFiles, type RankableFile } from './fuzzy'

describe('fuzzyScore', () => {
  it('matches an empty query trivially', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyScore('xyz', 'gate.ts')).toBeNull()
    expect(fuzzyScore('ba', 'abc')).toBeNull()
  })

  it('records matched positions in order', () => {
    const m = fuzzyScore('gt', 'gate.ts')
    expect(m).not.toBeNull()
    // 'g' at 0, 't' at first 't' (index 2 in "gate.ts")
    expect(m!.positions).toEqual([0, 2])
  })

  it('ranks an exact prefix above a scattered match', () => {
    const prefix = fuzzyScore('gate', 'gate.ts')!
    const scattered = fuzzyScore('gate', 'g-a-t-e.ts')!
    expect(prefix.score).toBeGreaterThan(scattered.score)
  })

  it('rewards matches at separator boundaries', () => {
    // 'gp' hitting g(boundary) + p(after '-') should beat a gappy interior match.
    const boundary = fuzzyScore('gp', 'gate-paths.ts')!
    const interior = fuzzyScore('gp', 'gateproxy.ts')!
    expect(boundary.score).toBeGreaterThan(interior.score)
  })
})

describe('rankFiles', () => {
  const files: RankableFile[] = [
    { path: 'src/main/security/gate.ts', name: 'gate.ts' },
    { path: 'src/main/security/gate-paths.ts', name: 'gate-paths.ts' },
    { path: 'src/renderer/App.vue', name: 'App.vue' },
    { path: 'docs/notes.md', name: 'notes.md' },
  ]

  it('returns nothing for an empty query', () => {
    expect(rankFiles('', files)).toEqual([])
  })

  it('ranks a filename match above a path-only match', () => {
    // "app" is in the App.vue filename but only in the path of others.
    const ranked = rankFiles('app', files)
    expect(ranked[0].file.name).toBe('App.vue')
    expect(ranked[0].matchedName).toBe(true)
  })

  it('exposes name positions for highlighting when the name matched', () => {
    const ranked = rankFiles('gate', files)
    const top = ranked[0]
    expect(top.matchedName).toBe(true)
    expect(top.positions).toEqual([0, 1, 2, 3])
  })

  it('applies a recency boost to break ties', () => {
    const withoutRecency = rankFiles('gate', files)
    const withRecency = rankFiles('gate', files, ['src/main/security/gate-paths.ts'])
    // gate.ts wins on raw score (shorter, exact); recency on gate-paths flips it.
    expect(withoutRecency[0].file.name).toBe('gate.ts')
    expect(withRecency[0].file.name).toBe('gate-paths.ts')
  })

  it('drops non-matching files and respects the limit', () => {
    const ranked = rankFiles('gate', files, [], 1)
    expect(ranked).toHaveLength(1)
    expect(ranked.every(r => r.file.name.includes('gate'))).toBe(true)
  })
})
