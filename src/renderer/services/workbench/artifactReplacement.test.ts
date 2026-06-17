import { describe, expect, it } from 'vitest'
import { editorArtifactReplacementDecision } from './artifactReplacement.js'
import type { ArtifactEntry } from './entries.js'

function file(path: string): ArtifactEntry {
  return {
    id: `file:${path}`,
    kind: 'file',
    title: path.split('/').pop() ?? path,
    path,
  }
}

describe('artifact replacement helpers', () => {
  it('allows replacing clean editor documents', () => {
    expect(editorArtifactReplacementDecision(
      file('notes.md'),
      file('other.md'),
      { path: 'notes.md', name: 'notes.md', dirty: false },
    )).toBe('yes')
  })

  it('asks for confirmation before moving away from a dirty active file artifact', () => {
    expect(editorArtifactReplacementDecision(
      file('notes.md'),
      file('other.md'),
      { path: 'notes.md', name: 'notes.md', dirty: true },
    )).toBe('needs-confirmation')
  })

  it('does not block when the dirty editor tab is not the active artifact', () => {
    expect(editorArtifactReplacementDecision(
      file('notes.md'),
      file('other.md'),
      { path: 'draft.md', name: 'draft.md', dirty: true },
    )).toBe('yes')
  })

  it('asks for confirmation before replacing a dirty untitled editor artifact', () => {
    expect(editorArtifactReplacementDecision(
      { id: 'artifact:editor', kind: 'editor', title: 'Editor' },
      file('other.md'),
      { path: '', name: 'Untitled', dirty: true },
    )).toBe('needs-confirmation')
  })

  it('asks for confirmation before closing a dirty active file artifact', () => {
    expect(editorArtifactReplacementDecision(
      file('notes.md'),
      null,
      { path: 'notes.md', name: 'notes.md', dirty: true },
    )).toBe('needs-confirmation')
  })
})
