import { describe, expect, it } from 'vitest'
import { isMacShortcutPlatform, shortcutLabel } from './shortcutLabels.js'

describe('shortcutLabel', () => {
  it('uses compact glyph labels on Apple platforms', () => {
    expect(shortcutLabel(['Mod', 'Shift', 'E'], 'MacIntel')).toBe('⇧⌘E')
    expect(shortcutLabel(['Ctrl', 'Shift', 'Tab'], 'darwin')).toBe('⌃⇧Tab')
  })

  it('uses text labels on Linux and Windows', () => {
    expect(shortcutLabel(['Mod', 'Shift', 'E'], 'Linux x86_64')).toBe('Ctrl+Shift+E')
    expect(shortcutLabel(['Mod', ','], 'Win32')).toBe('Ctrl+,')
  })
})

describe('isMacShortcutPlatform', () => {
  it('detects only Apple-style platforms as mac shortcuts', () => {
    expect(isMacShortcutPlatform('MacIntel')).toBe(true)
    expect(isMacShortcutPlatform('darwin')).toBe(true)
    expect(isMacShortcutPlatform('Linux x86_64')).toBe(false)
    expect(isMacShortcutPlatform('Win32')).toBe(false)
  })
})
