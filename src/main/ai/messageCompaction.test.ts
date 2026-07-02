import { describe, expect, it } from 'vitest'
import {
  BROWSER_TOOL_COMPACTION_NOTE,
  compactBrowserToolResultsForContext,
  estimateMessagesTokens,
} from './messageCompaction.js'

function browserOpenPart(id: number, observation = 'content') {
  return {
    type: 'tool-browser_open',
    toolCallId: `call_${id}`,
    state: 'output-available',
    input: { url: `https://example.com/${id}` },
    output: {
      url: `https://example.com/${id}`,
      title: `Page ${id}`,
      observation,
      refs: [{ ref: '1', kind: 'link', label: `Link ${id}`, href: `https://example.com/${id}/next` }],
      ref_count: 1,
      content_length: observation.length,
    },
  }
}

function browserActPart(id: number, observation = 'content') {
  return {
    type: 'tool-browser_act',
    toolCallId: `act_${id}`,
    state: 'output-available',
    input: { action: 'click', ref: '1' },
    output: {
      action: { changed: true, observe_next: true },
      observation: {
        url: `https://example.com/${id}`,
        title: `Page ${id}`,
        observation,
        refs: [{ ref: '2', kind: 'button', label: `Button ${id}` }],
        ref_count: 1,
        content_length: observation.length,
      },
    },
  }
}

describe('browser tool message compaction', () => {
  it('estimates message tokens from the serialized message array', () => {
    const small = [{ role: 'user', parts: [{ type: 'text', text: 'hello world' }] }]
    const large = [{ role: 'assistant', parts: [browserOpenPart(1, 'x'.repeat(4000))] }]

    expect(estimateMessagesTokens(small)).toBeGreaterThan(0)
    expect(estimateMessagesTokens(large)).toBeGreaterThan(estimateMessagesTokens(small))
  })

  it('keeps completed browser tool results but compacts old observation and refs fields', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant',
      parts: [
        browserOpenPart(1, 'old open '.repeat(20)),
        browserActPart(2, 'old act '.repeat(20)),
        browserOpenPart(3, 'newer open '.repeat(20)),
        browserActPart(4, 'newest act '.repeat(20)),
      ],
    }]

    const result = compactBrowserToolResultsForContext(messages, {
      thresholdTokens: 1,
      keepLatestResults: 2,
    })

    expect(result.changed).toBe(true)
    expect(result.compactedCount).toBe(2)
    expect(result.messages).not.toBe(messages)

    const parts = result.messages[0].parts
    expect(parts[0]).toMatchObject({
      type: 'tool-browser_open',
      toolCallId: 'call_1',
      state: 'output-available',
      output: {
        title: 'Page 1',
        observation: BROWSER_TOOL_COMPACTION_NOTE,
        refs: [{ ref: 'content-removed', kind: 'notice', label: BROWSER_TOOL_COMPACTION_NOTE }],
        refs_truncated: true,
        compacted: true,
      },
    })
    expect(parts[1].output.observation).toMatchObject({
      title: 'Page 2',
      observation: BROWSER_TOOL_COMPACTION_NOTE,
      refs: [{ ref: 'content-removed', kind: 'notice', label: BROWSER_TOOL_COMPACTION_NOTE }],
      refs_truncated: true,
      compacted: true,
    })
    expect(parts[2].output.observation).toContain('newer open')
    expect(parts[3].output.observation.observation).toContain('newest act')
  })

  it('does not compact when the estimate is below threshold', () => {
    const messages = [{ id: 'a1', role: 'assistant', parts: [browserOpenPart(1)] }]

    const result = compactBrowserToolResultsForContext(messages, {
      thresholdTokens: 1_000_000,
      keepLatestResults: 2,
    })

    expect(result.changed).toBe(false)
    expect(result.messages).toBe(messages)
  })

  it('does not compact already-compacted browser result notes again', () => {
    const messages = [{
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          ...browserOpenPart(1, BROWSER_TOOL_COMPACTION_NOTE),
          output: {
            ...browserOpenPart(1, BROWSER_TOOL_COMPACTION_NOTE).output,
            refs: [{ ref: 'content-removed', kind: 'notice', label: BROWSER_TOOL_COMPACTION_NOTE }],
            compacted: true,
            compacted_reason: 'context_preservation',
          },
        },
        browserOpenPart(2, 'new content '.repeat(20)),
        browserOpenPart(3, 'newer content '.repeat(20)),
      ],
    }]

    const result = compactBrowserToolResultsForContext(messages, {
      thresholdTokens: 1,
      keepLatestResults: 2,
    })

    expect(result.changed).toBe(false)
    expect(result.messages).toBe(messages)
  })
})
