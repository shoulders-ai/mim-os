export function currentShortcutPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform
}

export function isMacShortcutPlatform(platform: string = currentShortcutPlatform()): boolean {
  return platform === 'darwin' || /Mac|iPhone|iPad|iPod/i.test(platform)
}

export function shortcutLabel(parts: string[], platform: string = currentShortcutPlatform()): string {
  const mac = isMacShortcutPlatform(platform)
  const labels = orderShortcutParts(parts, mac).map(part => shortcutTokenLabel(part, mac))
  return mac ? labels.join('') : labels.join('+')
}

function orderShortcutParts(parts: string[], mac: boolean): string[] {
  const order = mac
    ? ['Ctrl', 'Alt', 'Shift', 'Mod']
    : ['Ctrl', 'Mod', 'Alt', 'Shift']
  const modifiers = parts.filter(part => order.includes(part))
  const rest = parts.filter(part => !order.includes(part))
  return [
    ...order.flatMap(part => modifiers.includes(part) ? [part] : []),
    ...rest,
  ]
}

function shortcutTokenLabel(part: string, mac: boolean): string {
  if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
  if (part === 'Shift') return mac ? '⇧' : 'Shift'
  if (part === 'Alt') return mac ? '⌥' : 'Alt'
  if (part === 'Ctrl') return mac ? '⌃' : 'Ctrl'
  if (part === 'Enter') return mac ? '↵' : 'Enter'
  return part
}
