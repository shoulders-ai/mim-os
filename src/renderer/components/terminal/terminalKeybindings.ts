type TerminalKeyEvent = Pick<KeyboardEvent, 'type' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

function isMacShortcutPlatform(platform: string): boolean {
  return platform === 'darwin' || /Mac|iPhone|iPad|iPod/i.test(platform)
}

function currentShortcutPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform
}

export function terminalOsShortcutSequence(
  event: TerminalKeyEvent,
  platform: string = currentShortcutPlatform(),
): string | null {
  if (event.type !== 'keydown') return null

  if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return '\x16\n'
  }

  const isMac = isMacShortcutPlatform(platform)
  const lineBoundaryModifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
  if (!lineBoundaryModifier || event.altKey || event.shiftKey) return null

  if (event.key === 'ArrowLeft') return '\x01'
  if (event.key === 'ArrowRight') return '\x05'

  return null
}
