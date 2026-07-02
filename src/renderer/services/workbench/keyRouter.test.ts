import { describe, it, expect } from 'vitest'
import { routeKeyEvent, type KeyContext } from './keyRouter.js'

function ctx(overrides: Partial<KeyContext> = {}): KeyContext {
  return {
    key: '',
    metaOrCtrl: true,
    shift: false,
    ctrlKey: false,
    altKey: false,
    editorFocused: false,
    terminalFocused: false,
    defaultPrevented: false,
    focusedPane: 'work',
    ...overrides,
  }
}

describe('routeKeyEvent', () => {
  // ── Command palette ──
  it('Cmd+P opens the command palette', () => {
    expect(routeKeyEvent(ctx({ key: 'p' }))).toEqual({ action: 'open-command-palette' })
  })

  it('Cmd+K opens the command palette when not in editor or terminal', () => {
    expect(routeKeyEvent(ctx({ key: 'k' }))).toEqual({ action: 'open-command-palette' })
  })

  it('Cmd+K does NOT open palette when editor is focused', () => {
    expect(routeKeyEvent(ctx({ key: 'k', editorFocused: true }))).toBeNull()
  })

  it('Cmd+K does NOT open palette when terminal is focused', () => {
    expect(routeKeyEvent(ctx({ key: 'k', terminalFocused: true }))).toBeNull()
  })

  // ── Chat / terminal creation ──
  it('Cmd+N creates a new chat', () => {
    expect(routeKeyEvent(ctx({ key: 'n' }))).toEqual({ action: 'new-chat' })
  })

  it('Cmd+N is ignored when editor is focused', () => {
    expect(routeKeyEvent(ctx({ key: 'n', editorFocused: true }))).toBeNull()
  })

  it('Cmd+T creates a new terminal tab', () => {
    expect(routeKeyEvent(ctx({ key: 't' }))).toEqual({ action: 'new-terminal-tab' })
  })

  it('Cmd+T is ignored when editor is focused', () => {
    expect(routeKeyEvent(ctx({ key: 't', editorFocused: true }))).toBeNull()
  })

  // ── Navigator toggle ──
  it('Cmd+B toggles the Navigator', () => {
    expect(routeKeyEvent(ctx({ key: 'b' }))).toEqual({ action: 'toggle-navigator' })
  })

  it('Cmd+B is ignored when editor is focused (bold shortcut)', () => {
    expect(routeKeyEvent(ctx({ key: 'b', editorFocused: true }))).toBeNull()
  })

  // ── Pane history: Cmd+[ / Cmd+] ──
  it('Cmd+[ navigates Work history back when Work is focused', () => {
    expect(routeKeyEvent(ctx({ key: '[', focusedPane: 'work' }))).toEqual({ action: 'work-history-back' })
  })

  it('Cmd+] navigates Work history forward when Work is focused', () => {
    expect(routeKeyEvent(ctx({ key: ']', focusedPane: 'work' }))).toEqual({ action: 'work-history-forward' })
  })

  it('Cmd+[ navigates Artifact history back when Artifact is focused', () => {
    expect(routeKeyEvent(ctx({ key: '[', focusedPane: 'artifact' }))).toEqual({ action: 'artifact-history-back' })
  })

  it('Cmd+] navigates Artifact history forward when Artifact is focused', () => {
    expect(routeKeyEvent(ctx({ key: ']', focusedPane: 'artifact' }))).toEqual({ action: 'artifact-history-forward' })
  })

  it('Cmd+[ defaults to Work history when no pane is focused', () => {
    expect(routeKeyEvent(ctx({ key: '[', focusedPane: 'none' }))).toEqual({ action: 'work-history-back' })
  })

  it('Cmd+[ is ignored when editor is focused (indent-less)', () => {
    expect(routeKeyEvent(ctx({ key: '[', editorFocused: true }))).toBeNull()
  })

  it('Cmd+] is ignored when editor is focused (indent-more)', () => {
    expect(routeKeyEvent(ctx({ key: ']', editorFocused: true }))).toBeNull()
  })

  // ── Session cycling (Ctrl+Tab pattern, replaces the old Cmd+[ / Cmd+]) ──
  it('Ctrl+Tab cycles to the next session', () => {
    expect(routeKeyEvent(ctx({ key: 'Tab', metaOrCtrl: true, ctrlKey: true }))).toEqual({ action: 'session-next' })
  })

  it('Ctrl+Shift+Tab cycles to the previous session', () => {
    expect(routeKeyEvent(ctx({ key: 'Tab', metaOrCtrl: true, ctrlKey: true, shift: true }))).toEqual({ action: 'session-prev' })
  })

  it('Ctrl+Tab works while the editor is focused (browser-tab convention)', () => {
    expect(routeKeyEvent(ctx({ key: 'Tab', metaOrCtrl: true, ctrlKey: true, editorFocused: true }))).toEqual({ action: 'session-next' })
  })

  it('plain Tab is ignored', () => {
    expect(routeKeyEvent(ctx({ key: 'Tab', metaOrCtrl: false, ctrlKey: false }))).toBeNull()
  })

  it('Cmd+Tab (no ctrl) is left to the OS', () => {
    expect(routeKeyEvent(ctx({ key: 'Tab', metaOrCtrl: true, ctrlKey: false }))).toBeNull()
  })

  // ── Activity cycling (Cmd+Option+Arrow) ──
  it('Cmd+Option+ArrowRight cycles to next activity', () => {
    expect(routeKeyEvent(ctx({ key: 'ArrowRight', altKey: true }))).toEqual({ action: 'activity-next' })
  })

  it('Cmd+Option+ArrowLeft cycles to previous activity', () => {
    expect(routeKeyEvent(ctx({ key: 'ArrowLeft', altKey: true }))).toEqual({ action: 'activity-prev' })
  })

  it('Cmd+Option+ArrowRight works while editor is focused', () => {
    expect(routeKeyEvent(ctx({ key: 'ArrowRight', altKey: true, editorFocused: true }))).toEqual({ action: 'activity-next' })
  })

  it('Cmd+Option+ArrowRight works while terminal is focused', () => {
    expect(routeKeyEvent(ctx({ key: 'ArrowRight', altKey: true, terminalFocused: true }))).toEqual({ action: 'activity-next' })
  })

  it('Cmd+ArrowRight without Option does not cycle activity', () => {
    expect(routeKeyEvent(ctx({ key: 'ArrowRight', altKey: false }))).toBeNull()
  })

  // ── Guards ──
  it('ignores events with defaultPrevented', () => {
    expect(routeKeyEvent(ctx({ key: 'p', defaultPrevented: true }))).toBeNull()
  })

  it('ignores events without meta/ctrl', () => {
    expect(routeKeyEvent(ctx({ key: 'p', metaOrCtrl: false }))).toBeNull()
  })

  it('returns null for unrecognized keys', () => {
    expect(routeKeyEvent(ctx({ key: 'x' }))).toBeNull()
  })
})
