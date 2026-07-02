import { describe, expect, it } from 'vitest'
import { approvalDiffNotice, buildApprovalDiff } from './approvalDiff.js'
import type { ApprovalRequest } from '../stores/approvals.js'

function request(over: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    requestId: 'r1',
    toolName: 'fs.edit',
    actor: 'ai',
    category: 'write',
    risk: 'medium',
    mode: 'normal',
    reason: '',
    params: {},
    ...over,
  }
}

describe('buildApprovalDiff', () => {
  it('returns null when there is nothing reviewable', async () => {
    const diff = await buildApprovalDiff(request({ toolName: 'terminal.run', preview: undefined }), async () => null)
    expect(diff).toBeNull()
  })

  it('previews an edit as the file with the single replacement applied', async () => {
    const diff = await buildApprovalDiff(
      request({ params: { path: 'a.md' }, preview: { kind: 'edit', oldText: 'world', newText: 'there' } }),
      async () => 'hello world',
    )
    expect(diff).toEqual({ path: 'a.md', original: 'hello world', modified: 'hello there', kind: 'edit', matchCount: 1 })
  })

  it('previews edits with the same tolerant text matching as fs.edit', async () => {
    const original = 'She  said “hello”\r\ntoday.'
    const diff = await buildApprovalDiff(
      request({
        params: { path: 'typography.md' },
        preview: {
          kind: 'edit',
          oldText: 'She said "hello"\ntoday.',
          newText: 'She said hello today.',
        },
      }),
      async () => original,
    )
    expect(diff).toEqual({
      path: 'typography.md',
      original,
      modified: 'She said hello today.',
      kind: 'edit',
      matchCount: 1,
    })
  })

  it('does not preview a replacement when fs.edit would reject ambiguous matches', async () => {
    const original = 'target one\ntarget two'
    const diff = await buildApprovalDiff(
      request({ params: { path: 'ambiguous.md' }, preview: { kind: 'edit', oldText: 'target', newText: 'replacement' } }),
      async () => original,
    )
    expect(diff).toEqual({ path: 'ambiguous.md', original, modified: original, kind: 'edit', matchCount: 2 })
  })

  it('reports zero matches when the edit target text is missing', async () => {
    const diff = await buildApprovalDiff(
      request({ params: { path: 'a.md' }, preview: { kind: 'edit', oldText: 'ghost', newText: 'x' } }),
      async () => 'no such text here',
    )
    expect(diff).toMatchObject({ modified: 'no such text here', matchCount: 0 })
  })

  it('previews a write as current content to proposed content', async () => {
    const diff = await buildApprovalDiff(
      request({ toolName: 'fs.write', params: { path: 'a.md' }, preview: { kind: 'write', content: 'new' } }),
      async () => 'old',
    )
    expect(diff).toEqual({ path: 'a.md', original: 'old', modified: 'new', kind: 'write' })
  })

  it('previews a create as empty to proposed content without reading disk', async () => {
    let reads = 0
    const diff = await buildApprovalDiff(
      request({ toolName: 'fs.create', params: { path: 'a.md' }, preview: { kind: 'create', content: 'hi' } }),
      async () => { reads++; return null },
    )
    expect(diff).toEqual({ path: 'a.md', original: '', modified: 'hi', kind: 'create' })
    expect(reads).toBe(0)
  })

  it('previews a delete as the full file being removed', async () => {
    const diff = await buildApprovalDiff(
      request({ toolName: 'fs.delete', params: { path: 'a.md' }, preview: { kind: 'delete' } }),
      async () => 'doomed',
    )
    expect(diff).toEqual({ path: 'a.md', original: 'doomed', modified: '', kind: 'delete' })
  })

  it('treats a missing file as empty original', async () => {
    const diff = await buildApprovalDiff(
      request({ toolName: 'fs.write', params: { path: 'new.md' }, preview: { kind: 'write', content: 'x' } }),
      async () => null,
    )
    expect(diff?.original).toBe('')
  })
})

describe('approvalDiffNotice', () => {
  it('warns when an edit has no match, so an empty diff is not read as harmless', () => {
    expect(approvalDiffNotice({ path: 'a.md', original: 'x', modified: 'x', kind: 'edit', matchCount: 0 }))
      .toBe('No match found — this edit will fail as written.')
  })

  it('warns when an edit is ambiguous', () => {
    expect(approvalDiffNotice({ path: 'a.md', original: 'x', modified: 'x', kind: 'edit', matchCount: 3 }))
      .toBe('Matches 3 places — this edit will fail as written.')
  })

  it('stays silent for a unique match and for non-edit kinds', () => {
    expect(approvalDiffNotice({ path: 'a.md', original: 'x', modified: 'y', kind: 'edit', matchCount: 1 })).toBeUndefined()
    expect(approvalDiffNotice({ path: 'a.md', original: '', modified: 'y', kind: 'create' })).toBeUndefined()
    expect(approvalDiffNotice({ path: 'a.md', original: 'x', modified: '', kind: 'delete' })).toBeUndefined()
  })
})
