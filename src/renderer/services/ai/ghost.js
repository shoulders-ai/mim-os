import { mapAiError } from './errors.js'
import { aiApiBase, aiFetch } from './aiApi.js'

export async function requestGhostSuggestions({ before, after, modelId = '' }) {
  try {
    const base = await aiApiBase()
    const response = await aiFetch(`${base}/api/ai/ghost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before, after, ...(modelId ? { modelId } : {}) }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error || 'Ghost suggestion request failed')
    }

    const result = await response.json()
    const suggestions = cleanSuggestions(result?.suggestions)
    return suggestions.length ? suggestions : []
  } catch (error) {
    console.warn('[ghost] suggestion fetch failed:', error?.message || error)
    const mapped = mapAiError(error)
    if (mapped.kind === 'auth') {
      return { error: mapped.message }
    }
    // AI failure — return empty to stay silent (no canned fallback)
    return []
  }
}

function cleanSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return []
  const seen = new Set()
  const clean = []
  for (const item of suggestions) {
    if (typeof item !== 'string') continue
    const normalized = item.replace(/\r\n/g, '\n')
    if (!normalized.trim()) continue
    const key = normalized.trim()
    if (seen.has(key)) continue
    seen.add(key)
    clean.push(normalized)
  }
  return clean.slice(0, 5)
}
