export const BROWSER_TOOL_COMPACTION_TOKEN_THRESHOLD = 100_000
export const BROWSER_TOOL_RESULTS_TO_KEEP = 2
export const BROWSER_TOOL_COMPACTION_NOTE = '[content removed to preserve context; re-observe the live browser if this page state is needed]'

const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4

export interface BrowserToolCompactionResult<T> {
  messages: T[]
  changed: boolean
  estimatedTokens: number
  compactedCount: number
}

interface BrowserToolTarget {
  messageIndex: number
  partIndex: number
}

export function estimateMessagesTokens(messages: unknown): number {
  try {
    const json = JSON.stringify(messages ?? [])
    return Math.ceil(json.length / TOKEN_ESTIMATE_CHARS_PER_TOKEN)
  } catch {
    return 0
  }
}

export function compactBrowserToolResultsForContext<T extends { parts?: Array<Record<string, unknown>> }>(
  messages: T[],
  options: {
    thresholdTokens?: number
    keepLatestResults?: number
  } = {},
): BrowserToolCompactionResult<T> {
  const estimatedTokens = estimateMessagesTokens(messages)
  const thresholdTokens = options.thresholdTokens ?? BROWSER_TOOL_COMPACTION_TOKEN_THRESHOLD
  if (estimatedTokens <= thresholdTokens) {
    return { messages, changed: false, estimatedTokens, compactedCount: 0 }
  }

  const targets = browserToolTargets(messages)
  const keepLatestResults = Math.max(0, Math.floor(options.keepLatestResults ?? BROWSER_TOOL_RESULTS_TO_KEEP))
  if (targets.length <= keepLatestResults) {
    return { messages, changed: false, estimatedTokens, compactedCount: 0 }
  }

  const keep = new Set(
    targets
      .slice(Math.max(0, targets.length - keepLatestResults))
      .map(targetKey),
  )
  let changed = false
  let compactedCount = 0

  const compactedMessages = messages.map((message, messageIndex) => {
    const parts = message.parts
    if (!Array.isArray(parts)) return message

    let partsChanged = false
    const compactedParts = parts.map((part, partIndex) => {
      const key = targetKey({ messageIndex, partIndex })
      if (keep.has(key) || !isBrowserToolResultPart(part)) return part
      const compacted = compactBrowserToolPart(part)
      if (compacted === part) return part
      partsChanged = true
      compactedCount += 1
      return compacted
    })

    if (!partsChanged) return message
    changed = true
    return { ...message, parts: compactedParts }
  })

  return changed
    ? { messages: compactedMessages, changed: true, estimatedTokens, compactedCount }
    : { messages, changed: false, estimatedTokens, compactedCount: 0 }
}

function browserToolTargets(messages: Array<{ parts?: Array<Record<string, unknown>> }>): BrowserToolTarget[] {
  const targets: BrowserToolTarget[] = []
  messages.forEach((message, messageIndex) => {
    const parts = message.parts
    if (!Array.isArray(parts)) return
    parts.forEach((part, partIndex) => {
      if (isBrowserToolResultPart(part)) targets.push({ messageIndex, partIndex })
    })
  })
  return targets
}

function targetKey(target: BrowserToolTarget): string {
  return `${target.messageIndex}:${target.partIndex}`
}

function isBrowserToolResultPart(part: unknown): part is Record<string, unknown> {
  if (!part || typeof part !== 'object') return false
  const item = part as Record<string, unknown>
  if (item.state !== 'output-available') return false
  if (item.type !== 'tool-browser_open' && item.type !== 'tool-browser_act') return false
  return browserToolOutputHasObservation(item.output)
}

function browserToolOutputHasObservation(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false
  const item = output as Record<string, unknown>
  if (item.compacted === true && item.compacted_reason === 'context_preservation') return false
  if (typeof item.observation === 'string') return true
  if (Array.isArray(item.refs)) return true
  if (item.observation && typeof item.observation === 'object') {
    return browserToolOutputHasObservation(item.observation)
  }
  return false
}

function compactBrowserToolPart(part: Record<string, unknown>): Record<string, unknown> {
  const output = compactBrowserToolOutput(part.output)
  if (output === part.output) return part
  return { ...part, output }
}

function compactBrowserToolOutput(output: unknown): unknown {
  if (!output || typeof output !== 'object') return output
  const item = output as Record<string, unknown>

  if (typeof item.observation === 'string' || Array.isArray(item.refs)) {
    return compactObservationObject(item)
  }

  if (item.observation && typeof item.observation === 'object') {
    const nested = compactBrowserToolOutput(item.observation)
    if (nested !== item.observation) return { ...item, observation: nested }
  }

  return output
}

function compactObservationObject(output: Record<string, unknown>): Record<string, unknown> {
  return {
    ...output,
    observation: BROWSER_TOOL_COMPACTION_NOTE,
    refs: [{
      ref: 'content-removed',
      kind: 'notice',
      label: BROWSER_TOOL_COMPACTION_NOTE,
    }],
    refs_truncated: true,
    compacted: true,
    compacted_reason: 'context_preservation',
  }
}
