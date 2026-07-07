import { aiApiBase, aiFetch } from './aiApi.js'

const MAX_TASK_LABEL_CHARS = 40
const MAX_TASK_LABEL_WORDS = 4
const OPTION_WORDS = new Set([
  'alternative',
  'alternatives',
  'choice',
  'choices',
  'different',
  'option',
  'options',
  'recommend',
  'recommendation',
  'recommendations',
  'use',
  'versus',
  'vs',
])
const STOP_WORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'best',
  'can',
  'could',
  'different',
  'do',
  'for',
  'from',
  'get',
  'give',
  'help',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'please',
  'should',
  'some',
  'that',
  'the',
  'these',
  'this',
  'to',
  'use',
  'we',
  'what',
  'which',
  'with',
  'would',
  'you',
])
const TASK_ACTIONS = new Set([
  'analyze',
  'analyse',
  'check',
  'compare',
  'draft',
  'edit',
  'fix',
  'plan',
  'prepare',
  'review',
  'rewrite',
  'summarize',
  'summarise',
  'write',
])

export function isPlaceholderTaskLabel(label) {
  const text = String(label || '').trim()
  return text === 'Chat'
    || text === 'New chat'
    || text === 'New task'
    || /^Chat \d+$/.test(text)
    || /^Task \d+$/.test(text)
}

export function shouldRequestTaskLabel(session, messageCount = 0) {
  if (!session) return false
  if (session.taskLabelGenerated) return false
  if (messageCount !== 0) return false
  return isPlaceholderTaskLabel(session.label)
}

export function provisionalTaskLabel(userText, contextLabels = []) {
  const text = String(userText || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''

  const intent = detectIntent(text)
  const tokens = tokenize(text)
  const action = tokens.find(token => TASK_ACTIONS.has(token.normalized))?.display
  let keywords = tokens
    .filter(token => !STOP_WORDS.has(token.normalized))
    .filter(token => !OPTION_WORDS.has(token.normalized))
    .filter(token => !TASK_ACTIONS.has(token.normalized))
    .map(token => token.display)

  keywords = uniqueWords(keywords)
  if (!keywords.length) keywords = contextKeywordFallback(contextLabels)
  if (!keywords.length) return ''

  const words = intent === 'options'
    ? [...keywords.slice(0, 2), 'options']
    : action
      ? [action, ...keywords.slice(0, 2)]
      : keywords.slice(0, 3)

  return capitalizeFirst(cleanTaskLabel(words.join(' ')))
}

export function taskLabelContextLabels(attachments = [], contextChips = []) {
  const labels = []
  for (const attachment of attachments || []) {
    if (attachment?.filename) labels.push(attachment.filename)
  }
  for (const chip of contextChips || []) {
    const label = chip?.label || chip?.path || chip?.id
    if (label) labels.push(label)
  }
  return cleanContextLabels(labels)
}

export async function requestTaskLabel({ userText, contextLabels = [] }) {
  const base = await aiApiBase()
  const response = await aiFetch(`${base}/api/ai/task-label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userText,
      contextLabels: cleanContextLabels(contextLabels),
    }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(body || `Task label request failed: ${response.status}`)
  }
  const result = await response.json()
  return cleanTaskLabel(result?.label)
}

export function cleanTaskLabel(value) {
  const text = String(value || '')
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/^(task|label|title)\s*:\s*/i, '')
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/[.!?:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^(chat|task|help|question|conversation|discussion)$/i.test(text)) return ''
  return truncateTaskLabel(text)
}

function cleanContextLabels(labels) {
  const out = []
  const seen = new Set()
  for (const raw of labels || []) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label.slice(0, 120))
    if (out.length >= 8) break
  }
  return out
}

function detectIntent(text) {
  const normalized = text.toLowerCase()
  if (/\b(options?|alternatives?|choices?|recommendations?|versus|vs)\b/.test(normalized)) return 'options'
  if (/\bwhat (are|is|would be).*\b(use|choose|pick)\b/.test(normalized)) return 'options'
  if (/\bwhich\b.*\b(use|choose|pick|best)\b/.test(normalized)) return 'options'
  return 'task'
}

function tokenize(text) {
  const matches = text.match(/[A-Za-z0-9][A-Za-z0-9.+#/-]*/g) || []
  return matches.map(raw => ({
    normalized: raw.toLowerCase().replace(/['’]s$/, ''),
    display: displayWord(raw),
  }))
}

function displayWord(raw) {
  const lower = raw.toLowerCase().replace(/['’]s$/, '')
  if (lower === 'apis') return 'API'
  if (lower === 'api') return 'API'
  if (lower === 'rb24') return 'RB24'
  if (/^[A-Z0-9]{2,}$/.test(raw)) return raw
  return lower
}

function uniqueWords(words) {
  const out = []
  const seen = new Set()
  for (const word of words) {
    const key = word.toLowerCase()
    if (!word || seen.has(key)) continue
    seen.add(key)
    out.push(word)
  }
  return out
}

function contextKeywordFallback(contextLabels) {
  const labels = cleanContextLabels(contextLabels)
  if (!labels.length) return []
  const base = labels[0]
    .split('/')
    .pop()
    ?.replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[_-]+/g, ' ') || ''
  return tokenize(base)
    .filter(token => !STOP_WORDS.has(token.normalized))
    .slice(0, 3)
    .map(token => token.display)
}

function truncateTaskLabel(text) {
  const words = text.split(/\s+/).filter(Boolean).slice(0, MAX_TASK_LABEL_WORDS)
  return words.join(' ').slice(0, MAX_TASK_LABEL_CHARS).trim()
}

function capitalizeFirst(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}
