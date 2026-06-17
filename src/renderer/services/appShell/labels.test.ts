import { describe, expect, it } from 'vitest'
import {
  artifactRailMeta,
  artifactSubtitle,
  artifactTitle,
  recentWorkspaceMenuItems,
  workRailMeta,
  workSubtitle,
  workTitle,
  workspaceLabel,
} from './labels.js'
import type { ArtifactEntry, WorkEntry } from '../workbench/entries.js'
import type { AgentSessionRuntime, PackageRunRecord } from '../../stores/runs.js'

describe('app shell labels', () => {
  it('derives compact workspace names from POSIX and Windows paths', () => {
    expect(workspaceLabel('/Users/me/mim-workspace/')).toBe('mim-workspace')
    expect(workspaceLabel('C:\\Users\\me\\Project')).toBe('Project')
    expect(workspaceLabel('/')).toBe('/')
  })

  it('filters the current workspace from the recent workspace menu', () => {
    expect(recentWorkspaceMenuItems([
      '/Users/me/current',
      '/Users/me/other',
      'C:\\Users\\me\\Win',
    ], '/Users/me/current')).toEqual([
      { path: '/Users/me/other', name: 'other' },
      { path: 'C:\\Users\\me\\Win', name: 'Win' },
    ])
  })

  it('prefers live package-run and agent-session titles over stale Work titles', () => {
    const packageWork: WorkEntry = {
      id: 'work:package-run:pkg:run-1',
      kind: 'package-run',
      packageId: 'pkg',
      runId: 'run-1',
      title: 'Old run title',
    }
    const agentWork: WorkEntry = {
      id: 'work:agent-session:sess-1',
      kind: 'agent-session',
      agentId: 'codex',
      sessionId: 'sess-1',
      title: 'Old agent title',
    }
    const packageRun: PackageRunRecord = {
      runId: 'run-1',
      packageId: 'pkg',
      jobId: 'job',
      label: 'Fresh run title',
      status: 'running',
      inputs: {},
      startedAt: '2026-01-01T00:00:00.000Z',
      events: [],
    }
    const agentSession: AgentSessionRuntime = {
      sessionId: 'sess-1',
      agentId: 'codex',
      title: 'Fresh agent title',
      command: 'codex',
      cwd: '/tmp',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    }

    expect(workTitle(packageWork, null, [packageRun], [])).toBe('Fresh run title')
    expect(workTitle(agentWork, null, [], [agentSession])).toBe('Fresh agent title')
  })

  it('keeps chat labels synced to the active session label', () => {
    const chatWork: WorkEntry = {
      id: 'work:chat:s1',
      kind: 'chat',
      sessionId: 's1',
      title: 'Chat',
    }

    expect(workTitle(chatWork, 'Literature plan', [], [])).toBe('Literature plan')
    expect(workTitle(chatWork, null, [], [])).toBe('Chat')
  })

  it('maps Work and Artifact entries to pane subtitles and rail metadata', () => {
    expect(workSubtitle({ id: 'work:files', kind: 'files', title: 'Files' })).toBe('Files')
    expect(workSubtitle({ id: 'work:activity-trust', kind: 'activity-trust', title: 'Monitor' })).toBe('Monitor')
    expect(workSubtitle({ id: 'work:archive', kind: 'archive', title: 'History' })).toBe('History')
    expect(workRailMeta({ id: 'work:terminal', kind: 'terminal', title: 'Terminal' })).toBe('Terminal')
    expect(workRailMeta(null)).toBe('Work')

    const fileArtifact: ArtifactEntry = {
      id: 'file:docs/a.md',
      kind: 'file',
      title: 'a.md',
      path: 'docs/a.md',
    }
    expect(artifactTitle(fileArtifact)).toBe('a.md')
    expect(artifactSubtitle(fileArtifact)).toBe('docs/a.md')
    expect(artifactRailMeta(fileArtifact)).toBe('File')
    expect(artifactTitle(null)).toBe('Artifact')
    expect(artifactSubtitle(null)).toBe('Empty')
    expect(artifactRailMeta(null)).toBe('Empty')
  })
})
