import { aiApiBase, aiFetch } from './aiApi.js'

/**
 * Generate a conversation summary via the cheap extract model.
 * Falls back to the last user message if generation fails.
 */
export async function requestSummary({ messages }) {
  const base = await aiApiBase()
  const response = await aiFetch(`${base}/api/ai/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!response.ok) throw new Error(`Summary request failed: ${response.status}`)
  const result = await response.json()
  return result.summary || ''
}

/**
 * Extract the last user message text from a messages array.
 */
export function lastUserMessageText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    if (typeof msg.content === 'string') return msg.content
    if (Array.isArray(msg.parts)) {
      const text = msg.parts
        .filter(p => p.type === 'text')
        .map(p => p.text || '')
        .join('\n')
        .trim()
      if (text) return text
    }
  }
  return ''
}

/**
 * Build a seed message for a new session from a summary or fallback.
 */
export function buildSeedMessage(summary, fallbackText) {
  const text = summary || fallbackText
  if (!text) return null
  const prefix = summary
    ? 'Continuing from a previous conversation. Here is the summary:\n\n'
    : 'Continuing from a previous conversation. Here is the last message:\n\n'
  return `${prefix}${text}`
}
