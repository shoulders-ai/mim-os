const patterns = [
  { re: /no api key|api key missing|key not configured/i, message: 'API key missing. Open Settings to add your key.', kind: 'auth' },
  { re: /no (ai )?model available|no (compatible|configured)[\w\s]*model/i, message: 'No model available for your keys. Open Settings to add a key or pick a configured model.', kind: 'auth' },
  { re: /not in allowlist/i, message: 'AI provider URL blocked. Check your allowed providers in Settings.', kind: 'auth' },
  { re: /401|403|unauthorized|forbidden/i, message: 'API key rejected. Open Settings to update your key.', kind: 'auth' },
  { re: /429|rate limit|quota/i, message: 'Rate limit reached. Wait a moment and try again.', kind: 'limit' },
  { re: /budget|spending limit/i, message: 'Monthly budget limit reached. Adjust your budget in Settings.', kind: 'limit' },
  { re: /context.?length|too many tokens|max_tokens|maximum.?context/i, message: 'This conversation exceeds the model\'s context window. Start a fresh session to continue.', kind: 'limit' },
  { re: /413|payload too large|request entity|content_too_large|request_too_large/i, message: 'Request payload too large. Try a shorter message.', kind: 'limit' },
  { re: /content filter|safety|blocked/i, message: 'Request blocked by content filter.', kind: 'provider' },
  { re: /TimeoutError|AbortError/i, message: 'Request timed out. Check your connection and try again.', kind: 'network' },
  { re: /timed? out|timeout|ETIMEDOUT/i, message: 'Request timed out. Check your connection and try again.', kind: 'network' },
  { re: /fetch failed|ECONNREFUSED|ENOTFOUND|network/i, message: 'Network request failed. Check your internet connection and try again.', kind: 'network' },
  { re: /ai provider returned/i, message: 'The AI provider returned an error. Try again or switch models in the model picker.', kind: 'provider' },
]

export function mapAiError(error) {
  const message = String(error?.message || error || '')
  // Also check error.name for DOMException types (AbortError, TimeoutError)
  const name = error?.name || ''
  const combined = `${name} ${message}`
  for (const { re, message: msg, kind } of patterns) {
    if (re.test(combined)) return { message: msg, kind }
  }
  return { message: 'An unexpected error occurred. Check the console for details.', kind: 'unknown' }
}
