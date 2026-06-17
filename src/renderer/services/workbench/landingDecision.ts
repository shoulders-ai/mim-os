// Pure decision logic for the first-launch landing surface.
// Determines which Work surface to show when restoring the initial state.

export type LandingTarget =
  | { target: 'last-session'; sessionId: string }
  | { target: 'chat-draft' }

/**
 * Decide where to land when the app boots with no active Work entry.
 *
 * Rules:
 * - If there is an active session from the previous run, resume it.
 * - Otherwise, land on the Chat draft (its empty state already shows the
 *   API-key banner and composer prompt). This replaces the old behavior of
 *   opening the empty Files table on first launch.
 */
export function decideLanding(activeSessionId: string | null): LandingTarget {
  if (activeSessionId) {
    return { target: 'last-session', sessionId: activeSessionId }
  }
  return { target: 'chat-draft' }
}
