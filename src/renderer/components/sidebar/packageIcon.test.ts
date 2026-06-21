import { describe, expect, it } from 'vitest'
import { isImageIcon, iconUiRel, packageIconUrl } from './packageIcon.js'

describe('isImageIcon', () => {
  it('treats svg and png paths as image icons', () => {
    expect(isImageIcon('./ui/icon.svg')).toBe(true)
    expect(isImageIcon('icon.svg')).toBe(true)
    expect(isImageIcon('./ui/mark.PNG')).toBe(true)
  })

  it('treats letter tokens and other strings as text icons', () => {
    expect(isImageIcon('G')).toBe(false)
    expect(isImageIcon('MD')).toBe(false)
    expect(isImageIcon('')).toBe(false)
    expect(isImageIcon(undefined)).toBe(false)
    expect(isImageIcon(null)).toBe(false)
  })
})

describe('iconUiRel', () => {
  it('strips ./ and a leading ui/ to mirror view src resolution', () => {
    expect(iconUiRel('./ui/icon.svg')).toBe('icon.svg')
    expect(iconUiRel('icon.svg')).toBe('icon.svg')
    expect(iconUiRel('./ui/sub/mark.svg')).toBe('sub/mark.svg')
  })
})

describe('packageIconUrl', () => {
  it('builds the served app asset URL, encoding segments', () => {
    expect(packageIconUrl('./ui/icon.svg', 'github-monitor', 43211)).toBe(
      'http://127.0.0.1:43211/packages/github-monitor/icon.svg',
    )
    expect(packageIconUrl('./ui/a b/c.svg', 'my pkg', 9)).toBe(
      'http://127.0.0.1:9/packages/my%20pkg/a%20b/c.svg',
    )
  })
})
