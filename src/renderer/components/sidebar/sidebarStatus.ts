// Pure status→presentation mapping for Navigator rows. Keeping these out of
// ShellSidebar.vue makes the tag/dot vocabulary testable and reusable by row
// components without prop-drilling store lookups.
import type { SessionStatusKind } from '../../stores/sessions.js'
import type { RunStatus } from '../../stores/runs.js'
import type { PingOutcome } from '../../stores/pings.js'

export function sessionStatusTag(kind: SessionStatusKind, justFinished: boolean): string | null {
  if (kind === 'working') return 'Working'
  if (kind === 'needs-approval') return 'Approve'
  if (kind === 'awaiting-review') return 'Review'
  if (kind === 'error') return 'Error'
  if (justFinished) return 'Done'
  return null
}

export function runStatusTag(status: RunStatus): string | null {
  if (status === 'working') return 'Working'
  if (status === 'waiting') return 'Waiting'
  if (status === 'needs-approval') return 'Approve'
  if (status === 'needs-input') return 'Input'
  if (status === 'ready-to-review') return 'Review'
  if (status === 'error') return 'Error'
  if (status === 'paused') return 'Paused'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'stopped') return 'Stopped'
  if (status === 'missing') return 'Missing'
  return null
}

// A fired "ping when done" shows a prominent outcome tag until the row is
// opened — this doubles as the row's strong done state.
export function pingOutcomeLabel(outcome: PingOutcome): string {
  if (outcome === 'error') return 'Error'
  if (outcome === 'input') return 'Input'
  return 'Done'
}

export function pingOutcomeClass(outcome: PingOutcome): string {
  return outcome === 'error' ? 'text-rem' : 'text-accent'
}

export function runStatusDotClass(status: RunStatus): string {
  if (status === 'needs-input' || status === 'needs-approval' || status === 'ready-to-review') return 'bg-accent'
  if (status === 'error' || status === 'missing') return 'bg-rem'
  return ''
}

// Empty string = no dot. Chats only carry a dot while something is worth
// noticing; an idle chat monogram stays quiet.
export function sessionDotClass(kind: SessionStatusKind, justFinished: boolean): string {
  if (kind === 'needs-approval' || kind === 'awaiting-review') return 'bg-accent'
  if (kind === 'error') return 'bg-rem'
  return ''
}

// Instances (chats/runs) have no icon, so collapsed rails show a 1-2 char
// monogram derived from the title. Keyed to content, not position, so it
// stays meaningful as Activity reorders.
export function initialsFrom(text: string): string {
  const cleaned = (text || '').trim()
  if (!cleaned) return '·'
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0]! + words[1][0]!).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}
