// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { applyThemeToDocument } from './themeSync.js'

describe('applyThemeToDocument', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
  })

  it('sets the data-theme attribute on the document element', () => {
    applyThemeToDocument('dracula')
    expect(document.documentElement.dataset.theme).toBe('dracula')
  })

  it('overwrites a previously applied theme', () => {
    applyThemeToDocument('glacier')
    applyThemeToDocument('nord')
    expect(document.documentElement.dataset.theme).toBe('nord')
  })
})
