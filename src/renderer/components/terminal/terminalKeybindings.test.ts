import { describe, expect, it } from 'vitest'
import { terminalOsShortcutSequence } from './terminalKeybindings.js'

function event(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: 'keydown',
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('terminalOsShortcutSequence', () => {
  it('maps Shift+Enter to a literal line feed for shell multiline input', () => {
    expect(terminalOsShortcutSequence(event({ key: 'Enter', shiftKey: true }))).toBe('\x16\n')
  })

  it('maps macOS line-boundary shortcuts to readline control bytes', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true }), 'MacIntel')).toBe('\x01')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', metaKey: true }), 'MacIntel')).toBe('\x05')
  })

  it('maps Linux and Windows Ctrl+Arrow line-boundary shortcuts to readline control bytes', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', ctrlKey: true }), 'Linux x86_64')).toBe('\x01')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', ctrlKey: true }), 'Win32')).toBe('\x05')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true }), 'Linux x86_64')).toBeNull()
  })

  it('leaves modified variants and non-keydown events to xterm or panel shortcuts', () => {
    expect(terminalOsShortcutSequence(event({ key: 'Enter', shiftKey: true, metaKey: true }))).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'Enter' }))).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true, altKey: true }), 'MacIntel')).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', metaKey: true, shiftKey: true }), 'MacIntel')).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true, ctrlKey: true }), 'MacIntel')).toBeNull()
    expect(terminalOsShortcutSequence(event({ type: 'keyup', key: 'ArrowLeft', metaKey: true }), 'MacIntel')).toBeNull()
  })
})
