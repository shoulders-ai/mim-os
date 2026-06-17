import { describe, expect, it } from 'vitest'
import {
  COMMENTS_CONTEXT_MEDIA_TYPE,
  buildCommentsContextAttachment,
  buildCommentsInstruction,
  toCommentThreadContext,
} from './sendToChat.js'

describe('comments send-to-chat helpers', () => {
  const thread = {
    id: 'k3f9',
    anchor: 'a staged rollout',
    notes: [
      { by: 'paul', at: '2026-06-13T09:14', text: 'Too slow.' },
      { by: 'ai', at: '2026-06-13T09:20', text: 'Phase 2 gates it.' },
    ],
    tagFrom: 10,
    tagTo: 120,
    anchorFrom: 24,
    anchorTo: 40,
  }

  it('drops editor-only offsets from thread context', () => {
    expect(toCommentThreadContext(thread)).toEqual({
      id: 'k3f9',
      anchor: 'a staged rollout',
      notes: thread.notes,
    })
  })

  it('builds a structured comments context attachment', () => {
    const attachment = buildCommentsContextAttachment({
      path: 'docs/plan.md',
      threads: [toCommentThreadContext(thread)],
    })

    expect(attachment).toMatchObject({
      filename: '1 comment on plan.md',
      mediaType: COMMENTS_CONTEXT_MEDIA_TYPE,
      kind: 'comments',
      path: 'docs/plan.md',
    })
    const parsed = JSON.parse(attachment.content)
    expect(parsed.path).toBe('docs/plan.md')
    expect(parsed.threads).toEqual([toCommentThreadContext(thread)])
    expect(parsed.instruction).toContain('comment thread')
    expect(parsed.document).toBeUndefined()
  })

  it('includes document text when provided', () => {
    const doc = '# Plan\n\nWe propose <comment id="k3f9">a staged rollout</comment> now.'
    const attachment = buildCommentsContextAttachment({
      path: 'docs/plan.md',
      threads: [toCommentThreadContext(thread)],
      document: doc,
    })
    const parsed = JSON.parse(attachment.content)
    expect(parsed.document).toBe(doc)
  })

  it('builds a short human-facing instruction for the composer draft', () => {
    expect(buildCommentsInstruction({
      path: 'docs/plan.md',
      threads: [toCommentThreadContext(thread), toCommentThreadContext({ ...thread, id: 'x4' })],
    })).toBe('Address these 2 comments.')

    expect(buildCommentsInstruction({
      path: 'docs/plan.md',
      threads: [toCommentThreadContext(thread)],
    })).toBe('Address this comment.')
  })
})
