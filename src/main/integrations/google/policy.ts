import { connectorPolicyFromTools } from '@main/tools/toolPolicy.js'

export interface GoogleConnectorPolicy {
  aiEnabled: boolean
  gmailEnabled: boolean
  gmailSendEnabled: boolean
  calendarEnabled: boolean
  calendarWriteEnabled: boolean
  driveEnabled: boolean
  sheetsWriteEnabled: boolean
}

export const GOOGLE_POLICY_DEFAULTS: Readonly<GoogleConnectorPolicy> = {
  aiEnabled: false,
  gmailEnabled: false,
  gmailSendEnabled: false,
  calendarEnabled: false,
  calendarWriteEnabled: false,
  driveEnabled: false,
  sheetsWriteEnabled: false,
}

export function readGooglePolicy(workspacePath: string | null): GoogleConnectorPolicy {
  const toolPolicy = connectorPolicyFromTools(workspacePath)
  if (toolPolicy.explicit && toolPolicy.google) return toolPolicy.google
  return { ...GOOGLE_POLICY_DEFAULTS }
}
