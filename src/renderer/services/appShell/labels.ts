import type { ArtifactEntry, WorkEntry } from '../workbench/entries.js'
import {
  packageRunDisplayTitle,
  type AgentSessionRuntime,
  type PackageRunRecord,
} from '../../stores/runs.js'

export interface WorkspaceMenuItem {
  path: string
  name: string
}

export function workspaceLabel(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path
}

export function recentWorkspaceMenuItems(
  recentWorkspaces: string[],
  currentWorkspace: string | null,
): WorkspaceMenuItem[] {
  return recentWorkspaces
    .filter(path => path !== currentWorkspace)
    .map(path => ({ path, name: workspaceLabel(path) }))
}

export function workTitle(
  work: WorkEntry | null,
  activeSessionLabel: string | null,
  packageRuns: PackageRunRecord[],
  agentSessions: AgentSessionRuntime[],
): string | null {
  if (work?.kind === 'package-run') {
    const run = packageRuns.find(item => item.runId === work.runId)
    if (run) return packageRunDisplayTitle(run)
  }
  if (work?.kind === 'agent-session') {
    const session = agentSessions.find(item => item.sessionId === work.sessionId)
    if (session) return session.title
  }
  if (work?.kind === 'chat') return activeSessionLabel ?? work.title
  return work?.title ?? activeSessionLabel
}

export function workSubtitle(work: WorkEntry | null): string {
  if (!work) return ''
  if (work.kind === 'chat') return 'Chat'
  if (work.kind === 'routines') return 'Routines'
  if (work.kind === 'terminal') return 'Terminal'
  if (work.kind === 'files') return 'Files'
  if (work.kind === 'activity-trust') return 'Monitor'
  if (work.kind === 'package-view') return 'App'
  if (work.kind === 'archive') return 'History'
  if (work.kind === 'package-run') return 'Run'
  if (work.kind === 'agent-session') return 'Agent'
  return ''
}

export function workRailMeta(work: WorkEntry | null): string {
  return workSubtitle(work) || 'Work'
}

export function artifactTitle(artifact: ArtifactEntry | null): string {
  return artifact?.title ?? 'Editor'
}

export function artifactSubtitle(artifact: ArtifactEntry | null): string {
  if (!artifact) return 'Empty'
  if (artifact.kind === 'file') return artifact.path
  if (artifact.kind === 'editor') return 'Editor'
  return artifact.kind
}

export function artifactRailMeta(artifact: ArtifactEntry | null): string {
  if (!artifact) return 'Empty'
  if (artifact.kind === 'file') return 'File'
  if (artifact.kind === 'editor') return 'Edit'
  return 'Obj'
}
