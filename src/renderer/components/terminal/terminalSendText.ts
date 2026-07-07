/**
 * Joins multi-line text for terminal pty input.
 * Converts LF line-endings to CR (what terminals expect), ensures exactly
 * one trailing CR (the "execute" return), and avoids doubling a trailing newline.
 *
 * When `bracketedPaste` is true AND the text is multi-line, wraps the body in
 * bracketed-paste escape markers (\x1b[200~ ... \x1b[201~) so that R's readline
 * treats the paste as a single unit rather than executing line-by-line.
 * Single-line text or opt-out: existing behavior exactly.
 */
export function joinForTerminal(text: string, opts?: { bracketedPaste?: boolean }): string {
  // Normalize CRLF to LF first
  const normalized = text.replace(/\r\n/g, '\n')
  // Strip one trailing newline if present (we add our own CR at end)
  const stripped = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized

  const isMultiLine = stripped.includes('\n')

  if (opts?.bracketedPaste && isMultiLine) {
    // Bracketed paste: \x1b[200~ + CR-joined body (no trailing CR inside) + \x1b[201~ + trailing CR to execute
    const body = stripped.replace(/\n/g, '\r')
    return `\x1b[200~${body}\x1b[201~\r`
  }

  return stripped.replace(/\n/g, '\r') + '\r'
}

/**
 * Split a payload string into chunks of at most `size` characters.
 * Splitting mid-escape-sequence is fine — the pty is a byte stream and
 * reassembles the full sequence from sequential writes.
 */
export function chunkPayload(payload: string, size = 16_384): string[] {
  if (payload.length <= size) return [payload]
  const chunks: string[] = []
  for (let i = 0; i < payload.length; i += size) {
    chunks.push(payload.slice(i, i + size))
  }
  return chunks
}

/**
 * Maximum payload size (chars) accepted by sendText. Payloads exceeding this
 * are rejected with an error toast to prevent freezing the terminal.
 */
export const PAYLOAD_MAX_CHARS = 2_000_000
