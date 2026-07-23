import { connectorPolicyFromTools } from '@main/tools/toolPolicy.js'

export interface SlackConnectorPolicy {
  aiEnabled: boolean
  sendEnabled: boolean
  privateChannels: boolean
  directMessages: boolean
}

export const SLACK_POLICY_DEFAULTS: Readonly<SlackConnectorPolicy> = {
  aiEnabled: false,
  sendEnabled: false,
  privateChannels: false,
  directMessages: false,
}

export function readSlackPolicy(workspacePath: string | null): SlackConnectorPolicy {
  const toolPolicy = connectorPolicyFromTools(workspacePath)
  if (toolPolicy.explicit && toolPolicy.slack) return toolPolicy.slack
  return { ...SLACK_POLICY_DEFAULTS }
}
