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
  it('maps Shift+Enter to a literal line feed for terminal shell multiline input', () => {
    expect(terminalOsShortcutSequence(event({ key: 'Enter', shiftKey: true }), {
      profile: 'terminal',
    })).toBe('\x16\n')
  })

  it('maps agent Shift+Enter to Alt+Enter when modern keyboard protocol is not active', () => {
    for (const profile of ['claude-code', 'gemini-cli', 'codex'] as const) {
      expect(terminalOsShortcutSequence(event({ key: 'Enter', shiftKey: true }), {
        profile,
      })).toBe('\x1b\r')
    }
  })

  it('maps macOS line-boundary shortcuts to readline control bytes', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true }), { platform: 'MacIntel' })).toBe('\x01')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', metaKey: true }), { platform: 'MacIntel' })).toBe('\x05')
  })

  it('maps macOS agent line-boundary shortcuts to Home and End sequences', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true }), {
      platform: 'MacIntel',
      profile: 'claude-code',
    })).toBe('\x1b[H')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', metaKey: true }), {
      platform: 'MacIntel',
      profile: 'gemini-cli',
    })).toBe('\x1b[F')
  })

  it('maps macOS terminal Option+Arrow to explicit xterm modified cursor sequences', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', altKey: true }), {
      platform: 'MacIntel',
      profile: 'terminal',
    })).toBe('\x1b[1;3D')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', altKey: true }), {
      platform: 'MacIntel',
      profile: 'terminal',
    })).toBe('\x1b[1;3C')
  })

  it('maps macOS terminal Option+Shift+Arrow to the same safe word movement sequences', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', altKey: true, shiftKey: true }), {
      platform: 'MacIntel',
      profile: 'terminal',
    })).toBe('\x1b[1;3D')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', altKey: true, shiftKey: true }), {
      platform: 'MacIntel',
      profile: 'terminal',
    })).toBe('\x1b[1;3C')
  })

  it('maps macOS terminal Option+Backspace to the shell word-delete control byte', () => {
    expect(terminalOsShortcutSequence(event({ key: 'Backspace', altKey: true }), {
      platform: 'MacIntel',
      profile: 'terminal',
    })).toBe('\x17')

    expect(terminalOsShortcutSequence(event({ key: 'Backspace', altKey: true }), {
      platform: 'MacIntel',
      profile: 'codex',
    })).toBeNull()
  })

  it('leaves macOS agent Option+Arrow to xterm instead of rewriting it to Alt-letter commands', () => {
    for (const profile of ['claude-code', 'gemini-cli', 'codex'] as const) {
      expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', altKey: true }), {
        platform: 'MacIntel',
        profile,
      })).toBeNull()
      expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', altKey: true }), {
        platform: 'MacIntel',
        profile,
      })).toBeNull()
    }
  })

  it('maps Linux and Windows Ctrl+Arrow line-boundary shortcuts to readline control bytes', () => {
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', ctrlKey: true }), { platform: 'Linux x86_64' })).toBe('\x01')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', ctrlKey: true }), { platform: 'Win32' })).toBe('\x05')
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true }), { platform: 'Linux x86_64' })).toBeNull()
  })

  it('leaves modified variants and non-keydown events to xterm or panel shortcuts', () => {
    expect(terminalOsShortcutSequence(event({ key: 'Enter', shiftKey: true, metaKey: true }))).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'Enter' }))).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true, altKey: true }), { platform: 'MacIntel' })).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'ArrowRight', metaKey: true, shiftKey: true }), { platform: 'MacIntel' })).toBeNull()
    expect(terminalOsShortcutSequence(event({ key: 'ArrowLeft', metaKey: true, ctrlKey: true }), { platform: 'MacIntel' })).toBeNull()
    expect(terminalOsShortcutSequence(event({ type: 'keyup', key: 'ArrowLeft', metaKey: true }), { platform: 'MacIntel' })).toBeNull()
  })
})
