/**
 * Pure decision logic for the quit-with-unsaved-work guard.
 * Extracted for testability — the main process wires it to dialog.showMessageBoxSync.
 */

export interface CloseGuardDecision {
  /** Whether to show the native confirmation dialog */
  shouldPrompt: boolean
  /** Confirmation message if shouldPrompt is true */
  message: string
}

export function closeGuardDecision(dirtyTabCount: number, activeRunCount = 0, activeAgentCount = 0): CloseGuardDecision {
  if (dirtyTabCount <= 0 && activeRunCount <= 0 && activeAgentCount <= 0) {
    return { shouldPrompt: false, message: '' }
  }
  const parts: string[] = []
  if (dirtyTabCount > 0) {
    const noun = dirtyTabCount === 1 ? 'tab' : 'tabs'
    parts.push(`${dirtyTabCount} unsaved ${noun}`)
  }
  if (activeRunCount > 0) {
    const noun = activeRunCount === 1 ? 'package run' : 'package runs'
    parts.push(`${activeRunCount} active ${noun}`)
  }
  if (activeAgentCount > 0) {
    const noun = activeAgentCount === 1 ? 'agent session' : 'agent sessions'
    parts.push(`${activeAgentCount} running ${noun}`)
  }
  let joined: string
  if (parts.length === 1) {
    joined = parts[0]
  } else if (parts.length === 2) {
    joined = `${parts[0]} and ${parts[1]}`
  } else {
    joined = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  }
  return {
    shouldPrompt: true,
    message: `You have ${joined}. Quit anyway?`,
  }
}
