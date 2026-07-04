/**
 * Joins multi-line text for terminal pty input.
 * Converts LF line-endings to CR (what terminals expect), ensures exactly
 * one trailing CR (the "execute" return), and avoids doubling a trailing newline.
 */
export function joinForTerminal(text: string): string {
  // Normalize CRLF to LF first
  const normalized = text.replace(/\r\n/g, '\n')
  // Strip one trailing newline if present (we add our own CR at end)
  const stripped = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return stripped.replace(/\n/g, '\r') + '\r'
}
