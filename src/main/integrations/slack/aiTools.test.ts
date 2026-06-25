import { describe, expect, it } from 'vitest'
import { buildSlackAiTools } from './aiTools.js'
import type { SlackConnectorPolicy } from './policy.js'

const BASE_POLICY: SlackConnectorPolicy = {
  aiEnabled: false,
  sendEnabled: false,
  privateChannels: false,
  directMessages: false,
}

function policy(overrides: Partial<SlackConnectorPolicy>): SlackConnectorPolicy {
  return { ...BASE_POLICY, ...overrides }
}

function callRecorder() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []
  const call = async (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params })
    return { ok: true }
  }
  return { call, calls }
}

describe('buildSlackAiTools', () => {
  it('returns no tools when Slack AI access is disabled', () => {
    const { call } = callRecorder()

    expect(buildSlackAiTools(call, policy({ aiEnabled: false }))).toEqual({})
  })

  it('returns read tools when Slack AI access is enabled and send is disabled', () => {
    const { call } = callRecorder()
    const tools = buildSlackAiTools(call, policy({ aiEnabled: true, sendEnabled: false }))

    expect(Object.keys(tools).sort()).toEqual([
      'slack_channels',
      'slack_history',
      'slack_replies',
      'slack_search',
    ])
  })

  it('includes slack_send only when send is enabled', () => {
    const { call } = callRecorder()
    const tools = buildSlackAiTools(call, policy({ aiEnabled: true, sendEnabled: true }))

    expect(Object.keys(tools).sort()).toEqual([
      'slack_channels',
      'slack_history',
      'slack_replies',
      'slack_search',
      'slack_send',
    ])
  })

  it('delegates every Slack AI tool to the existing kernel tool name', async () => {
    const { call, calls } = callRecorder()
    const tools = buildSlackAiTools(call, policy({ aiEnabled: true, sendEnabled: true }))

    await tools.slack_search.execute?.({ query: 'from:rob budget', count: 5 }, {})
    await tools.slack_history.execute?.({ channel: 'C123', limit: 10 }, {})
    await tools.slack_channels.execute?.({ limit: 20 }, {})
    await tools.slack_replies.execute?.({ channel: 'C123', ts: '1234.5678', limit: 5 }, {})
    await tools.slack_send.execute?.({ channel: 'C123', text: 'Approved text' }, {})

    expect(calls).toEqual([
      { name: 'slack.search', params: { query: 'from:rob budget', count: 5 } },
      { name: 'slack.history', params: { channel: 'C123', limit: 10 } },
      { name: 'slack.channels', params: { limit: 20 } },
      { name: 'slack.replies', params: { channel: 'C123', ts: '1234.5678', limit: 5 } },
      { name: 'slack.send', params: { channel: 'C123', text: 'Approved text' } },
    ])
  })
})
