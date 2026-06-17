import { describe, it, expect } from 'vitest'
import { isValidSemver, compareSemver } from '@main/packages/semver.js'

describe('isValidSemver', () => {
  it('accepts plain x.y.z', () => {
    expect(isValidSemver('1.2.3')).toBe(true)
    expect(isValidSemver('0.0.0')).toBe(true)
    expect(isValidSemver('123.456.789')).toBe(true)
  })

  it('accepts prerelease suffix', () => {
    expect(isValidSemver('1.0.0-alpha')).toBe(true)
    expect(isValidSemver('1.0.0-alpha.1')).toBe(true)
    expect(isValidSemver('1.0.0-0.3.7')).toBe(true)
    expect(isValidSemver('1.0.0-x.7.z.92')).toBe(true)
  })

  it('accepts build metadata suffix', () => {
    expect(isValidSemver('1.0.0+build.123')).toBe(true)
    expect(isValidSemver('1.0.0+20130313144700')).toBe(true)
  })

  it('rejects combined prerelease + build metadata (spec regex has one suffix group)', () => {
    expect(isValidSemver('1.0.0-alpha+001')).toBe(false)
    expect(isValidSemver('1.0.0-beta.1+build.42')).toBe(false)
  })

  it('rejects missing components', () => {
    expect(isValidSemver('1.2')).toBe(false)
    expect(isValidSemver('1')).toBe(false)
    expect(isValidSemver('')).toBe(false)
  })

  it('allows leading zeros (spec regex permits [0-9]+)', () => {
    expect(isValidSemver('01.2.3')).toBe(true)
    expect(isValidSemver('1.02.3')).toBe(true)
  })

  it('rejects non-numeric version parts', () => {
    expect(isValidSemver('a.b.c')).toBe(false)
    expect(isValidSemver('1.2.x')).toBe(false)
  })

  it('rejects leading/trailing whitespace', () => {
    expect(isValidSemver(' 1.2.3')).toBe(false)
    expect(isValidSemver('1.2.3 ')).toBe(false)
  })

  it('rejects v prefix', () => {
    expect(isValidSemver('v1.2.3')).toBe(false)
  })

  it('rejects path separators in prerelease', () => {
    expect(isValidSemver('1.0.0-alpha/beta')).toBe(false)
    expect(isValidSemver('1.0.0-alpha\\beta')).toBe(false)
  })
})

describe('compareSemver', () => {
  it('sorts by major', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0)
  })

  it('sorts by minor', () => {
    expect(compareSemver('1.2.0', '1.1.0')).toBeGreaterThan(0)
    expect(compareSemver('1.1.0', '1.2.0')).toBeLessThan(0)
  })

  it('sorts by patch', () => {
    expect(compareSemver('1.0.2', '1.0.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.1', '1.0.2')).toBeLessThan(0)
  })

  it('equal versions compare as zero', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })

  it('prerelease < release (same x.y.z)', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0)
  })

  it('sorts prereleases alphabetically for determinism', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0)
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0)
  })

  it('prerelease of a lower version < release of that lower version', () => {
    expect(compareSemver('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.1-alpha')).toBeLessThan(0)
    expect(compareSemver('1.0.1-alpha', '1.0.1')).toBeLessThan(0)
  })

  it('build metadata is ignored for comparison', () => {
    expect(compareSemver('1.0.0+build1', '1.0.0+build2')).toBe(0)
  })

  it('works as a sort comparator to find the highest version', () => {
    const versions = ['0.9.0', '1.0.0-alpha', '1.0.0', '1.1.0', '2.0.0-beta', '2.0.0']
    const sorted = [...versions].sort(compareSemver)
    expect(sorted).toEqual(['0.9.0', '1.0.0-alpha', '1.0.0', '1.1.0', '2.0.0-beta', '2.0.0'])
  })
})
