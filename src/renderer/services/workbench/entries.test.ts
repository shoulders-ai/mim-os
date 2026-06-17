import { describe, expect, it } from 'vitest'
import {
  NAVIGATOR_HEADER_BRIDGE_INSET,
  NAVIGATOR_SPINE_WIDTH,
  activityTrustWorkEntry,
  agentSessionWorkEntry,
  archiveWorkEntry,
  chatDraftWorkEntry,
  chatWorkEntry,
  editorArtifactEntry,
  fileArtifactEntry,
  filesWorkEntry,
  packageRunWorkEntry,
  packageViewWorkEntry,
  terminalWorkEntry,
} from './entries.js'

describe('navigator chrome constants', () => {
  it('pins the collapsed rail width documented in workbench-layout.md', () => {
    expect(NAVIGATOR_SPINE_WIDTH).toBe(52)
  })

  it('pins the bridged header inset that aligns with the traffic-light grid', () => {
    // 52 (rail) + 8 (header pl-2) + 14 = 74, the next 20px slot after zoom at x=54.
    expect(NAVIGATOR_HEADER_BRIDGE_INSET).toBe(14)
    expect(NAVIGATOR_SPINE_WIDTH + 8 + NAVIGATOR_HEADER_BRIDGE_INSET).toBe(74)
  })
})

describe('work entry factories', () => {
  it('builds chat entries with session-scoped stable ids', () => {
    const entry = chatWorkEntry('s1')
    expect(entry).toEqual({ id: 'work:chat:s1', kind: 'chat', title: 'Chat', sessionId: 's1' })
    expect(chatWorkEntry('s1', 'Renamed').id).toBe('work:chat:s1')
    expect(chatWorkEntry('s1', 'Renamed').title).toBe('Renamed')
    expect(chatWorkEntry('s2').id).not.toBe(entry.id)
  })

  it('builds the chat draft on a reserved slot inside the chat id namespace', () => {
    const draft = chatDraftWorkEntry()
    expect(draft).toEqual({ id: 'work:chat:new', kind: 'chat-draft', title: 'Chat' })
    // The draft squats on sessionId "new"; real session ids are generated and
    // never collide with it.
    expect(draft.id).toBe(chatWorkEntry('new').id)
  })

  it('builds singleton terminal, files, activity, and archive entries', () => {
    expect(terminalWorkEntry()).toEqual({ id: 'work:terminal', kind: 'terminal', title: 'Terminal' })
    expect(filesWorkEntry()).toEqual({ id: 'work:files', kind: 'files', title: 'Files', query: '' })
    expect(activityTrustWorkEntry()).toEqual({ id: 'work:activity-trust', kind: 'activity-trust', title: 'Monitor' })
    expect(archiveWorkEntry()).toEqual({ id: 'work:archive', kind: 'archive', title: 'History' })
  })

  it('keeps the files entry id stable across queries so it replaces in place', () => {
    expect(filesWorkEntry('report').id).toBe(filesWorkEntry().id)
    expect(filesWorkEntry('report').query).toBe('report')
  })

  it('builds package view entries with a main default view', () => {
    expect(packageViewWorkEntry('slides', 'Slides')).toEqual({
      id: 'work:package-view:slides:main',
      kind: 'package-view',
      title: 'Slides',
      packageId: 'slides',
      viewId: 'main',
    })
    expect(packageViewWorkEntry('slides', 'Slides', 'config').id).toBe('work:package-view:slides:config')
  })

  it('builds package run entries keyed by package and run with a default title', () => {
    const entry = packageRunWorkEntry('slides', 'r1')
    expect(entry).toEqual({
      id: 'work:package-run:slides:r1',
      kind: 'package-run',
      title: 'slides run',
      packageId: 'slides',
      runId: 'r1',
    })
    expect(packageRunWorkEntry('slides', 'r2').id).not.toBe(entry.id)
    expect(packageRunWorkEntry('slides', 'r1', 'Deck build').title).toBe('Deck build')
  })

  it('builds agent session entries keyed by session id alone', () => {
    const entry = agentSessionWorkEntry('claude-code', 'a1', 'Claude Code')
    expect(entry).toEqual({
      id: 'work:agent-session:a1',
      kind: 'agent-session',
      title: 'Claude Code',
      agentId: 'claude-code',
      sessionId: 'a1',
    })
    // Session ids are globally unique, so the agent id is metadata, not part
    // of the entry identity.
    expect(agentSessionWorkEntry('codex', 'a1', 'Codex').id).toBe(entry.id)
    expect(agentSessionWorkEntry('claude-code', 'a2', 'Claude Code').id).not.toBe(entry.id)
  })
})

describe('artifact entry factories', () => {
  it('builds file artifacts titled by basename with the path-derived id', () => {
    expect(fileArtifactEntry('docs/notes.md')).toEqual({
      id: 'file:docs/notes.md',
      kind: 'file',
      title: 'notes.md',
      path: 'docs/notes.md',
    })
  })

  it('derives titles from unicode names, trailing slashes, and backslash paths', () => {
    expect(fileArtifactEntry('über/straße.md').title).toBe('straße.md')
    expect(fileArtifactEntry('a/b/').title).toBe('b')
    expect(fileArtifactEntry('a\\b\\c.txt').title).toBe('c.txt')
    expect(fileArtifactEntry('plain').title).toBe('plain')
    // Degenerate root path falls back to the path itself.
    expect(fileArtifactEntry('/').title).toBe('/')
  })

  it('keeps file artifact ids distinct per path so each file is its own slot', () => {
    expect(fileArtifactEntry('a.md').id).not.toBe(fileArtifactEntry('b.md').id)
    expect(fileArtifactEntry('a.md')).toEqual(fileArtifactEntry('a.md'))
  })

  it('builds the singleton editor artifact', () => {
    expect(editorArtifactEntry()).toEqual({ id: 'artifact:editor', kind: 'editor', title: 'Editor' })
  })

})
