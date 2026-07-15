import type { UIMessage } from 'ai'
import {
  compactBrowserToolResultsForContext,
  estimateMessagesTokens,
} from '@main/ai/messageCompaction.js'

export { estimateMessagesTokens } from '@main/ai/messageCompaction.js'

export interface ContextCompactionRecord {
  id: string
  firstKeptMessageId?: string
  firstKeptMessageIndex?: number
  summarizedMessageCount?: number
  summary: string
  tokensBefore?: number
  tokensAfter?: number
  savedRatio?: number
  modelId?: string
  trigger?: 'post_turn' | 'pre_turn' | 'overflow'
  createdAt: string
}

export interface BuildModelContextInput {
  messages: UIMessage[]
  compactions?: ContextCompactionRecord[]
  modelWindow?: number
  now?: Date
}

export interface BuildModelContextResult {
  messages: UIMessage[]
  appliedCompactionId?: string
  estimatedTokens: number
  stage1CompactedCount: number
}

export interface SelectCompactionCutInput {
  messages: UIMessage[]
  modelWindow?: number
  tailTargetTokens?: number
}

export interface CompactionCut {
  firstKeptMessageId?: string
  firstKeptMessageIndex: number
  summarizedMessageCount: number
  summarizedMessages: UIMessage[]
  keptMessages: UIMessage[]
  estimatedTailTokens: number
  estimatedSummarizedTokens: number
}

interface StringCompactionPolicy {
  maxChars: number
  headChars: number
  tailChars: number
}

interface PayloadCompactionResult {
  value: unknown
  changed: boolean
  compactedCount: number
}

interface TextCompactionResult {
  value: string
  metadata: {
    original_chars: number
    omitted_chars: number
    head_chars: number
    tail_chars: number
    hash: string
  }
}

const RECENT_TOOL_OUTPUTS_TO_KEEP = 2
const DUPLICATE_OUTPUT_MIN_CHARS = 4_000
const GENERIC_STRING_POLICY: StringCompactionPolicy = { maxChars: 10_000, headChars: 3_000, tailChars: 3_000 }
const SHELL_STDERR_POLICY: StringCompactionPolicy = { maxChars: 10_000, headChars: 2_500, tailChars: 4_000 }

const TOOL_OUTPUT_FIELD_POLICIES: Record<string, Record<string, StringCompactionPolicy>> = {
  fs_read: { content: GENERIC_STRING_POLICY },
  web_read: { content: GENERIC_STRING_POLICY },
  bash: {
    stdout: GENERIC_STRING_POLICY,
    stderr: SHELL_STDERR_POLICY,
  },
  code_run: {
    stdout: GENERIC_STRING_POLICY,
    stderr: SHELL_STDERR_POLICY,
  },
}

const TOOL_INPUT_FIELD_POLICIES: Record<string, Record<string, StringCompactionPolicy>> = {
  fs_write: { content: GENERIC_STRING_POLICY },
  fs_create: { content: GENERIC_STRING_POLICY },
  fs_edit: {
    old_text: GENERIC_STRING_POLICY,
    new_text: GENERIC_STRING_POLICY,
  },
}

const PROTECTED_GENERIC_STRING_FIELDS = new Set([
  'id',
  'toolCallId',
  'toolName',
  'status',
  'state',
  'url',
  'final_url',
  'source',
  'path',
  'runId',
  'runDir',
  'hash',
  'version',
  'mime',
  'name',
  'title',
  'query',
])

export function buildModelContext({
  messages,
  compactions = [],
}: BuildModelContextInput): BuildModelContextResult {
  const repaired = repairIncompleteToolMessages(messages)
  const compactedRecordView = applyLatestCompactionRecord(repaired.messages, compactions)
  const browserCompacted = compactBrowserToolResultsForContext(compactedRecordView.messages)
  const toolCompacted = compactToolPayloadsForContext(browserCompacted.messages as UIMessage[])
  const estimatedTokens = estimateMessagesTokens(toolCompacted.messages)

  return {
    messages: toolCompacted.messages,
    ...(compactedRecordView.appliedCompactionId ? { appliedCompactionId: compactedRecordView.appliedCompactionId } : {}),
    estimatedTokens,
    stage1CompactedCount: browserCompacted.compactedCount + toolCompacted.compactedCount,
  }
}

export function repairIncompleteToolMessages(messages: UIMessage[]): { messages: UIMessage[], changed: boolean } {
  let changed = false
  const repaired: UIMessage[] = []

  for (const message of messages) {
    const parts = (message as { parts?: unknown[] }).parts
    if (message.role !== 'assistant' || !Array.isArray(parts)) {
      repaired.push(message)
      continue
    }

    const nextParts = parts.filter(part => !isNonTerminalToolPart(part))
    const substantiveParts = nextParts.filter(isSubstantiveAssistantPart)
    const messageChanged = nextParts.length !== parts.length
    if (messageChanged) changed = true
    if (!substantiveParts.length) {
      changed = true
      continue
    }
    repaired.push(messageChanged ? { ...message, parts: nextParts as UIMessage['parts'] } : message)
  }

  return changed ? { messages: repaired, changed: true } : { messages, changed: false }
}

export function selectCompactionCut({
  messages,
  modelWindow = 100_000,
  tailTargetTokens,
}: SelectCompactionCutInput): CompactionCut | null {
  if (messages.length < 2) return null

  const targetTokens = Math.max(1, Math.floor(
    tailTargetTokens ?? Math.min(20_000, Math.max(1_000, modelWindow * 0.2)),
  ))
  let firstKeptMessageIndex = messages.length
  let estimatedTailTokens = 0
  let tailHasUserMessage = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageTokens = Math.max(1, estimateMessagesTokens([messages[index]]))
    if (
      firstKeptMessageIndex < messages.length
      && tailHasUserMessage
      && estimatedTailTokens + messageTokens > targetTokens
    ) {
      break
    }

    firstKeptMessageIndex = index
    estimatedTailTokens += messageTokens
    if (messages[index].role === 'user') tailHasUserMessage = true
  }

  const lastUserMessageIndex = lastRoleIndex(messages, 'user')
  if (lastUserMessageIndex >= 0 && firstKeptMessageIndex > lastUserMessageIndex) {
    firstKeptMessageIndex = lastUserMessageIndex
  }

  if (firstKeptMessageIndex > 0 && messages[firstKeptMessageIndex]?.role !== 'user') {
    let userBoundary = -1
    for (let index = firstKeptMessageIndex + 1; index < messages.length; index += 1) {
      if (messages[index].role !== 'user') continue
      userBoundary = index
      break
    }
    if (userBoundary < 0) {
      for (let index = firstKeptMessageIndex - 1; index >= 0; index -= 1) {
        if (messages[index].role !== 'user') continue
        userBoundary = index
        break
      }
    }
    if (userBoundary >= 0) firstKeptMessageIndex = userBoundary
  }

  if (firstKeptMessageIndex <= 0 || firstKeptMessageIndex >= messages.length) return null

  const summarizedMessages = messages.slice(0, firstKeptMessageIndex)
  const keptMessages = messages.slice(firstKeptMessageIndex)
  return {
    firstKeptMessageId: messages[firstKeptMessageIndex]?.id,
    firstKeptMessageIndex,
    summarizedMessageCount: summarizedMessages.length,
    summarizedMessages,
    keptMessages,
    estimatedTailTokens: estimateMessagesTokens(keptMessages),
    estimatedSummarizedTokens: estimateMessagesTokens(summarizedMessages),
  }
}

function applyLatestCompactionRecord(
  messages: UIMessage[],
  compactions: ContextCompactionRecord[],
): { messages: UIMessage[]; appliedCompactionId?: string } {
  const record = compactions[compactions.length - 1]
  if (!record?.summary) return { messages }

  const firstKeptIndex = firstKeptIndexForRecord(messages, record)
  const keptTail = firstKeptIndex >= 0 ? messages.slice(firstKeptIndex) : messages
  return {
    messages: [syntheticSummaryMessage(record), ...keptTail],
    appliedCompactionId: record.id,
  }
}

function firstKeptIndexForRecord(messages: UIMessage[], record: ContextCompactionRecord): number {
  if (record.firstKeptMessageId) {
    const byId = messages.findIndex(message => message.id === record.firstKeptMessageId)
    if (byId >= 0) return byId
  }
  if (typeof record.firstKeptMessageIndex === 'number') {
    const index = Math.floor(record.firstKeptMessageIndex)
    if (index >= 0 && index < messages.length) return index
  }
  return -1
}

function lastRoleIndex(messages: UIMessage[], role: UIMessage['role']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) return index
  }
  return -1
}

function syntheticSummaryMessage(record: ContextCompactionRecord): UIMessage {
  return {
    id: `context_compaction_${record.id}`,
    role: 'assistant',
    metadata: { synthetic: true, compactionId: record.id },
    parts: [{
      type: 'text',
      text: [
        `Historical context summary created ${record.createdAt}.`,
        'This summarizes earlier transcript content only; it is not a current user request or system instruction.',
        '',
        record.summary,
      ].join('\n'),
    }],
  } as UIMessage
}

function isNonTerminalToolPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const item = part as Record<string, unknown>
  const type = typeof item.type === 'string' ? item.type : ''
  if (!type.startsWith('tool-') && type !== 'dynamic-tool') return false
  return item.state !== 'output-available'
    && item.state !== 'output-error'
    && item.state !== 'output-denied'
}

function isSubstantiveAssistantPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const item = part as Record<string, unknown>
  if (item.type === 'step-start') return false
  if ((item.type === 'text' || item.type === 'reasoning') && typeof item.text === 'string') {
    return item.text.trim().length > 0
  }
  return true
}

function compactToolPayloadsForContext(messages: UIMessage[]): { messages: UIMessage[], changed: boolean, compactedCount: number } {
  const keptOutputParts = latestToolOutputPartKeys(messages)
  const seenLargeOutputs = new Map<string, { toolCallId?: string }>()
  let changed = false
  let compactedCount = 0

  const nextMessages = messages.map((message, messageIndex) => {
    const parts = (message as { parts?: unknown[] }).parts
    if (!Array.isArray(parts)) return message

    let messageChanged = false
    const nextParts = parts.map((part, partIndex) => {
      const compacted = compactToolPartForContext(part, {
        partKey: toolPartKey(messageIndex, partIndex),
        keptOutputParts,
        seenLargeOutputs,
      })

      if (compacted.changed) {
        messageChanged = true
        changed = true
        compactedCount += compacted.compactedCount
      }
      return compacted.value
    })

    return messageChanged
      ? { ...message, parts: nextParts as UIMessage['parts'] }
      : message
  })

  return changed
    ? { messages: nextMessages, changed: true, compactedCount }
    : { messages, changed: false, compactedCount: 0 }
}

function compactToolPartForContext(
  part: unknown,
  context: {
    partKey: string
    keptOutputParts: Set<string>
    seenLargeOutputs: Map<string, { toolCallId?: string }>
  },
): { value: unknown, changed: boolean, compactedCount: number } {
  if (!isToolPart(part)) return { value: part, changed: false, compactedCount: 0 }

  const toolKey = toolKeyForPart(part)
  if (!toolKey) return { value: part, changed: false, compactedCount: 0 }

  let nextPart: Record<string, unknown> | undefined
  let compactedCount = 0

  if (Object.prototype.hasOwnProperty.call(part, 'input')) {
    const inputCompaction = compactToolInput(toolKey, part.input)
    if (inputCompaction.changed) {
      nextPart = { ...part, input: inputCompaction.value }
      compactedCount += inputCompaction.compactedCount
    }
  }

  if (
    !isBrowserToolKey(toolKey)
    && isOutputAvailableToolPart(part)
    && !context.keptOutputParts.has(context.partKey)
  ) {
    const partForOutput = nextPart ?? part
    const duplicateOutput = duplicateOutputReference(toolKey, partForOutput, context.seenLargeOutputs)
    if (duplicateOutput) {
      nextPart = { ...partForOutput, output: duplicateOutput }
      compactedCount += 1
    } else {
      const outputCompaction = compactToolOutput(toolKey, part.output)
      if (outputCompaction.changed) {
        nextPart = { ...partForOutput, output: outputCompaction.value }
        compactedCount += outputCompaction.compactedCount
      }
    }
  }

  if (isOutputAvailableToolPart(part)) {
    rememberLargeOutput(toolKey, part, context.seenLargeOutputs)
  }

  return nextPart
    ? { value: nextPart, changed: true, compactedCount }
    : { value: part, changed: false, compactedCount: 0 }
}

function latestToolOutputPartKeys(messages: UIMessage[]): Set<string> {
  const kept = new Set<string>()
  const countsByTool = new Map<string, number>()

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = (messages[messageIndex] as { parts?: unknown[] }).parts
    if (!Array.isArray(parts)) continue

    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (!isToolPart(part) || !isOutputAvailableToolPart(part)) continue

      const toolKey = toolKeyForPart(part)
      if (!toolKey || isBrowserToolKey(toolKey)) continue

      const count = countsByTool.get(toolKey) ?? 0
      if (count < RECENT_TOOL_OUTPUTS_TO_KEEP) {
        kept.add(toolPartKey(messageIndex, partIndex))
      }
      countsByTool.set(toolKey, count + 1)
    }
  }

  return kept
}

function compactToolInput(toolKey: string, input: unknown): PayloadCompactionResult {
  const fieldPolicies = TOOL_INPUT_FIELD_POLICIES[toolKey]
  if (fieldPolicies) return compactSelectedStringFields(input, fieldPolicies, false)
  return compactGenericPayload(input)
}

function compactToolOutput(toolKey: string, output: unknown): PayloadCompactionResult {
  const fieldPolicies = TOOL_OUTPUT_FIELD_POLICIES[toolKey]
  if (fieldPolicies) return compactSelectedStringFields(output, fieldPolicies, true)
  return compactGenericPayload(output, { markObject: true })
}

function compactSelectedStringFields(
  value: unknown,
  fieldPolicies: Record<string, StringCompactionPolicy>,
  markObject: boolean,
): PayloadCompactionResult {
  if (!isPlainRecord(value)) return { value, changed: false, compactedCount: 0 }

  let nextValue: Record<string, unknown> | undefined
  let compactedCount = 0

  for (const [field, policy] of Object.entries(fieldPolicies)) {
    const fieldValue = value[field]
    if (typeof fieldValue !== 'string' || value[`${field}_compacted`]) continue

    const compaction = compactLongString(fieldValue, policy)
    if (!compaction) continue

    nextValue ??= { ...value }
    nextValue[field] = compaction.value
    nextValue[`${field}_compacted`] = compaction.metadata
    compactedCount += 1
  }

  if (!nextValue) return { value, changed: false, compactedCount: 0 }
  if (markObject) {
    nextValue.compacted = true
    nextValue.compacted_reason = 'tool_text_fields_trimmed_for_model_context'
  }

  return { value: nextValue, changed: true, compactedCount }
}

function compactGenericPayload(
  value: unknown,
  options: { policy?: StringCompactionPolicy, markObject?: boolean, depth?: number } = {},
): PayloadCompactionResult {
  const policy = options.policy ?? GENERIC_STRING_POLICY
  const depth = options.depth ?? 0
  if (depth > 4) return { value, changed: false, compactedCount: 0 }

  if (typeof value === 'string') {
    const compaction = compactLongString(value, policy)
    return compaction
      ? { value: compaction.value, changed: true, compactedCount: 1 }
      : { value, changed: false, compactedCount: 0 }
  }

  if (Array.isArray(value)) {
    let nextArray: unknown[] | undefined
    let compactedCount = 0

    value.forEach((item, index) => {
      const itemCompaction = compactGenericPayload(item, { policy, depth: depth + 1 })
      if (!itemCompaction.changed) return

      nextArray ??= [...value]
      nextArray[index] = itemCompaction.value
      compactedCount += itemCompaction.compactedCount
    })

    return nextArray
      ? { value: nextArray, changed: true, compactedCount }
      : { value, changed: false, compactedCount: 0 }
  }

  if (!isPlainRecord(value)) return { value, changed: false, compactedCount: 0 }

  let nextValue: Record<string, unknown> | undefined
  let compactedCount = 0

  for (const [field, fieldValue] of Object.entries(value)) {
    if (field.endsWith('_compacted')) continue

    if (typeof fieldValue === 'string') {
      if (PROTECTED_GENERIC_STRING_FIELDS.has(field)) continue

      const compaction = compactLongString(fieldValue, policy)
      if (!compaction) continue

      nextValue ??= { ...value }
      nextValue[field] = compaction.value
      nextValue[`${field}_compacted`] = compaction.metadata
      compactedCount += 1
      continue
    }

    if (fieldValue && typeof fieldValue === 'object') {
      const nestedCompaction = compactGenericPayload(fieldValue, { policy, depth: depth + 1 })
      if (!nestedCompaction.changed) continue

      nextValue ??= { ...value }
      nextValue[field] = nestedCompaction.value
      compactedCount += nestedCompaction.compactedCount
    }
  }

  if (!nextValue) return { value, changed: false, compactedCount: 0 }
  if (options.markObject) {
    nextValue.compacted = true
    nextValue.compacted_reason = 'tool_text_fields_trimmed_for_model_context'
  }

  return { value: nextValue, changed: true, compactedCount }
}

function compactLongString(text: string, policy: StringCompactionPolicy): TextCompactionResult | undefined {
  if (text.length <= policy.maxChars) return undefined

  const headChars = Math.min(policy.headChars, text.length)
  const tailChars = Math.min(policy.tailChars, text.length - headChars)
  const omittedChars = text.length - headChars - tailChars
  if (omittedChars <= 0) return undefined

  const hash = hashText(text)
  return {
    value: [
      text.slice(0, headChars),
      `[model context compacted ${omittedChars} chars from this field; original_chars=${text.length}; hash=${hash}]`,
      text.slice(text.length - tailChars),
    ].join('\n'),
    metadata: {
      original_chars: text.length,
      omitted_chars: omittedChars,
      head_chars: headChars,
      tail_chars: tailChars,
      hash,
    },
  }
}

function duplicateOutputReference(
  toolKey: string,
  part: Record<string, unknown>,
  seenLargeOutputs: Map<string, { toolCallId?: string }>,
): Record<string, unknown> | undefined {
  const fingerprint = outputFingerprint(toolKey, part.output)
  if (!fingerprint) return undefined

  const seen = seenLargeOutputs.get(fingerprint.key)
  if (!seen) return undefined

  return {
    compacted: true,
    compacted_reason: 'duplicate_tool_result',
    duplicate_of_tool_call_id: seen.toolCallId,
    tool_key: toolKey,
    hash: fingerprint.hash,
    original_chars: fingerprint.originalChars,
  }
}

function rememberLargeOutput(
  toolKey: string,
  part: Record<string, unknown>,
  seenLargeOutputs: Map<string, { toolCallId?: string }>,
): void {
  const fingerprint = outputFingerprint(toolKey, part.output)
  if (!fingerprint || seenLargeOutputs.has(fingerprint.key)) return
  seenLargeOutputs.set(fingerprint.key, { toolCallId: typeof part.toolCallId === 'string' ? part.toolCallId : undefined })
}

function outputFingerprint(toolKey: string, output: unknown): { key: string, hash: string, originalChars: number } | undefined {
  let serialized: string
  try {
    serialized = JSON.stringify(output)
  } catch {
    return undefined
  }

  if (!serialized || serialized.length < DUPLICATE_OUTPUT_MIN_CHARS) return undefined

  const hash = hashText(serialized)
  return {
    key: `${toolKey}:${hash}`,
    hash,
    originalChars: serialized.length,
  }
}

function toolPartKey(messageIndex: number, partIndex: number): string {
  return `${messageIndex}:${partIndex}`
}

function toolKeyForPart(part: Record<string, unknown>): string | undefined {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' && part.toolName.trim()
      ? `dynamic:${part.toolName}`
      : 'dynamic:unknown'
  }

  if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) return undefined
  return part.type.slice('tool-'.length)
}

function isBrowserToolKey(toolKey: string): boolean {
  return toolKey === 'browser_open' || toolKey === 'browser_act'
}

function isToolPart(part: unknown): part is Record<string, unknown> {
  if (!part || typeof part !== 'object') return false
  const item = part as Record<string, unknown>
  return item.type === 'dynamic-tool'
    || (typeof item.type === 'string' && item.type.startsWith('tool-'))
}

function isOutputAvailableToolPart(part: Record<string, unknown>): boolean {
  return part.state === 'output-available' && Object.prototype.hasOwnProperty.call(part, 'output')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
