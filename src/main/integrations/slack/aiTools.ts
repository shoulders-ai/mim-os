import { tool } from 'ai'
import { z } from 'zod'
import type { SlackConnectorPolicy } from './policy.js'

type AiToolCall = (name: string, params: Record<string, unknown>) => Promise<unknown>
type AiToolMap = Record<string, ReturnType<typeof tool>>

export function buildSlackAiTools(
  call: AiToolCall,
  policy: SlackConnectorPolicy,
): AiToolMap {
  const slackTools: AiToolMap = {}
  if (!policy.aiEnabled) return slackTools

  slackTools.slack_search = tool({
    description: 'Search Slack messages for the configured workspace Slack account.',
    inputSchema: z.object({
      query: z.string(),
      count: z.number().int().positive().optional(),
    }),
    execute: async (params) => call('slack.search', params),
  })
  slackTools.slack_history = tool({
    description: 'Read recent Slack messages from a channel id.',
    inputSchema: z.object({
      channel: z.string(),
      limit: z.number().int().positive().optional(),
    }),
    execute: async (params) => call('slack.history', params),
  })
  slackTools.slack_channels = tool({
    description: 'List Slack channels for the configured workspace Slack account.',
    inputSchema: z.object({
      limit: z.number().int().positive().optional(),
    }),
    execute: async (params) => call('slack.channels', params),
  })
  slackTools.slack_replies = tool({
    description: 'Read threaded Slack replies for a message by channel and timestamp.',
    inputSchema: z.object({
      channel: z.string(),
      ts: z.string(),
      limit: z.number().int().positive().optional(),
    }),
    execute: async (params) => call('slack.replies', params),
  })
  if (policy.sendEnabled) {
    slackTools.slack_send = tool({
      description: 'Post a Slack message to a channel. High risk - requires user approval.',
      inputSchema: z.object({
        channel: z.string(),
        text: z.string(),
      }),
      execute: async (params) => call('slack.send', params),
    })
  }

  return slackTools
}
