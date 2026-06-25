type TerminalKeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

export type TerminalKeybindingProfile = 'terminal' | 'claude-code' | 'gemini-cli' | 'codex'

export interface TerminalShortcutOptions {
  platform?: string
  profile?: TerminalKeybindingProfile
}

function isMacShortcutPlatform(platform: string): boolean {
  return platform === 'darwin' || /Mac|iPhone|iPad|iPod/i.test(platform)
}

function currentShortcutPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform
}

export function terminalOsShortcutSequence(
  event: TerminalKeyEvent,
  options: TerminalShortcutOptions = {},
): string | null {
  if (event.type !== 'keydown') return null

  const platform = options.platform ?? currentShortcutPlatform()
  const profile = options.profile ?? 'terminal'
  const isMac = isMacShortcutPlatform(platform)
  const isAgent = profile !== 'terminal'

  if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (isAgent) return '\x1b\r'
    return '\x16\n'
  }

  if (!isAgent && isMac && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    if (event.key === 'ArrowLeft') return '\x1bb'
    if (event.key === 'ArrowRight') return '\x1bf'
    return null
  }

  const lineBoundaryModifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
  if (!lineBoundaryModifier || event.altKey || event.shiftKey) return null

  if (isAgent) {
    if (event.key === 'ArrowLeft') return '\x1b[H'
    if (event.key === 'ArrowRight') return '\x1b[F'
    return null
  }

  if (event.key === 'ArrowLeft') return '\x01'
  if (event.key === 'ArrowRight') return '\x05'

  return null
}
