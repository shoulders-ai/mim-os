import { describe, expect, it } from 'vitest'
import { buildApprovalDiff } from './approvalDiff.js'
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
    expect(diff).toEqual({ path: 'a.md', original: 'hello world', modified: 'hello there', kind: 'edit' })
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
