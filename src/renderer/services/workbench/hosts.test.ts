import { describe, expect, it } from 'vitest'
import { resolveArtifactHostId, resolveWorkHost } from './hosts.js'
import type { ArtifactEntry, WorkEntry } from './entries.js'

describe('workbench host resolvers', () => {
  it('resolves Work entries to Work hosts without separate tab state', () => {
    expect(resolveWorkHost(null)).toBe('files')
    expect(resolveWorkHost({ id: 'work:chat:s1', kind: 'chat', title: 'Chat', sessionId: 's1' })).toBe('chat')
    expect(resolveWorkHost({ id: 'work:chat:new', kind: 'chat-draft', title: 'Chat' })).toBe('chat')
    expect(resolveWorkHost({ id: 'work:terminal', kind: 'terminal', title: 'Terminal' })).toBe('terminal')
    expect(resolveWorkHost({ id: 'work:files', kind: 'files', title: 'Files' })).toBe('files')
    expect(resolveWorkHost({ id: 'work:activity-trust', kind: 'activity-trust', title: 'Monitor' })).toBe('activity-trust')
    expect(resolveWorkHost({ id: 'work:archive', kind: 'archive', title: 'Archive' })).toBe('archive')
    expect(resolveWorkHost({ id: 'work:package-view:p:main', kind: 'package-view', title: 'Package', packageId: 'p', viewId: 'main' })).toBe('package-view')
  })

  it('resolves app runs to their own Work identity', () => {
    const run = {
      id: 'work:package-run:p:r1',
      kind: 'package-run',
      title: 'Run',
      packageId: 'p',
      runId: 'r1',
    } satisfies WorkEntry

    expect(resolveWorkHost(run)).toBe('package-run')
  })

  it('resolves agent sessions to their own Work host', () => {
    const entry = {
      id: 'work:agent-session:a1',
      kind: 'agent-session',
      title: 'Claude Code',
      agentId: 'claude-code',
      sessionId: 'a1',
    } satisfies WorkEntry

    expect(resolveWorkHost(entry)).toBe('agent-session')
  })

  it('resolves Artifact entries to Artifact host ids without separate right-panel state', () => {
    expect(resolveArtifactHostId(null)).toBe('editor')
    expect(resolveArtifactHostId({ id: 'artifact:editor', kind: 'editor', title: 'Editor' })).toBe('editor')
    expect(resolveArtifactHostId({ id: 'file:notes.md', kind: 'file', title: 'notes.md', path: 'notes.md' })).toBe('editor')
  })

  it('keeps unknown external records on the editor host until a resolver exists', () => {
    const external = {
      id: 'external:issues:2',
      kind: 'external-record',
      title: 'Issue 2',
      source: 'issues',
      recordId: '2',
    } satisfies ArtifactEntry

    expect(resolveArtifactHostId(external)).toBe('editor')
  })
})
