import type { ArtifactEntry, WorkEntry } from './entries.js'

export type WorkHostKind =
  | 'chat'
  | 'terminal'
  | 'files'
  | 'activity-trust'
  | 'archive'
  | 'package-run'
  | 'package-view'
  | 'agent-session'

export function resolveWorkHost(entry: WorkEntry | null): WorkHostKind {
  if (!entry) return 'files'
  if (entry.kind === 'chat-draft') return 'chat'
  return entry.kind
}

export function resolveArtifactHostId(entry: ArtifactEntry | null): string {
  if (!entry) return 'editor'
  return 'editor'
}
