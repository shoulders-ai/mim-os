// Pure keyboard-shortcut routing logic. Maps key events to workbench actions
// without side effects — extracted from App.vue's handleKeydown for testability.

export type KeyAction =
  | { action: 'new-chat' }
  | { action: 'new-terminal-tab' }
  | { action: 'toggle-navigator' }
  | { action: 'work-history-back' }
  | { action: 'work-history-forward' }
  | { action: 'artifact-history-back' }
  | { action: 'artifact-history-forward' }
  | { action: 'open-command-palette' }
  | { action: 'session-next' }
  | { action: 'session-prev' }
  | null

export interface KeyContext {
  key: string
  metaOrCtrl: boolean
  shift: boolean
  ctrlKey: boolean
  editorFocused: boolean
  terminalFocused: boolean
  /** True when the native event was already handled (e.g., by CodeMirror). */
  defaultPrevented: boolean
  /** 'work' | 'artifact' — which pane the focused element belongs to. */
  focusedPane: 'work' | 'artifact' | 'none'
}

/**
 * Determine the workbench action for a keydown event.
 * Returns null when the shortcut should be ignored (no matching action or
 * an editable element should handle the event).
 */
export function routeKeyEvent(ctx: KeyContext): KeyAction {
  if (ctx.defaultPrevented) return null
  if (!ctx.metaOrCtrl && !ctx.ctrlKey) return null

  const { key, metaOrCtrl, ctrlKey, editorFocused, terminalFocused } = ctx

  // Cmd+P / Cmd+K → command palette (unless terminal/editor consumes the key)
  if (metaOrCtrl && (key === 'p' || key === 'P')) {
    return { action: 'open-command-palette' }
  }
  if (metaOrCtrl && (key === 'k' || key === 'K')) {
    // Cmd+K is consumed by CodeMirror (inline AI) and terminal (clear).
    if (editorFocused || terminalFocused) return null
    return { action: 'open-command-palette' }
  }

  // Cmd+N → new chat (editor handles its own Cmd+N for new untitled tab)
  if (metaOrCtrl && (key === 'n' || key === 'N')) {
    if (editorFocused) return null
    return { action: 'new-chat' }
  }

  // Cmd+T → new terminal tab (editor handles its own Cmd+T)
  if (metaOrCtrl && (key === 't' || key === 'T')) {
    if (editorFocused) return null
    return { action: 'new-terminal-tab' }
  }

  // Cmd+B → toggle Navigator (not in editor — Cmd+B is bold in markdown)
  if (metaOrCtrl && (key === 'b' || key === 'B')) {
    if (editorFocused) return null
    return { action: 'toggle-navigator' }
  }

  // Ctrl+Tab / Ctrl+Shift+Tab → cycle chat sessions (browser-tab convention;
  // requires the literal Ctrl key, never Cmd, and fires even while typing —
  // neither CodeMirror nor xterm binds Ctrl+Tab).
  if (ctrlKey && key === 'Tab') {
    return ctx.shift ? { action: 'session-prev' } : { action: 'session-next' }
  }

  // Cmd+[ / Cmd+] → focused pane's history Back/Forward
  // These previously cycled chat sessions globally; now they drive pane history.
  if (metaOrCtrl && key === '[') {
    if (editorFocused) return null  // Mod-[ is indent-less in CodeMirror
    if (ctx.focusedPane === 'artifact') return { action: 'artifact-history-back' }
    return { action: 'work-history-back' }
  }
  if (metaOrCtrl && key === ']') {
    if (editorFocused) return null  // Mod-] is indent-more in CodeMirror
    if (ctx.focusedPane === 'artifact') return { action: 'artifact-history-forward' }
    return { action: 'work-history-forward' }
  }

  return null
}
