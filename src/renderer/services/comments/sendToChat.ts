import type { CommentThread, Note } from '@main/comments/model.js'

export const COMMENTS_CONTEXT_MEDIA_TYPE = 'application/vnd.mim.comments+json'

export interface CommentThreadContext {
  id: string
  anchor: string
  notes: Note[]
}

export interface CommentsChatContext {
  path: string
  threads: CommentThreadContext[]
  document?: string
}

export interface CommentsContextAttachment {
  filename: string
  mediaType: string
  content: string
  kind: 'comments'
  path: string
  threads: CommentThreadContext[]
}

export function toCommentThreadContext(thread: CommentThread): CommentThreadContext {
  return {
    id: thread.id,
    anchor: thread.anchor,
    notes: thread.notes.map(note => ({ ...note })),
  }
}

export function buildCommentsContextAttachment(context: CommentsChatContext): CommentsContextAttachment {
  const threads = context.threads.map(thread => ({
    id: thread.id,
    anchor: thread.anchor,
    notes: thread.notes.map(note => ({ ...note })),
  }))
  const payload: Record<string, unknown> = {
    path: context.path,
    threads,
    instruction: [
      `Work through ${threads.length === 1 ? 'this comment thread' : `these ${threads.length} comment threads`}.`,
      'Reply with comments_reply, make changes with fs_edit, and resolve settled threads with comments_resolve.',
    ].join(' '),
  }
  if (context.document) payload.document = context.document

  return {
    filename: commentsContextFilename(context.path, threads.length),
    mediaType: COMMENTS_CONTEXT_MEDIA_TYPE,
    content: JSON.stringify(payload, null, 2),
    kind: 'comments',
    path: context.path,
    threads,
  }
}

export function buildCommentsInstruction(context: CommentsChatContext): string {
  const count = context.threads.length
  return count === 1 ? 'Address this comment.' : `Address these ${count} comments.`
}

function commentsContextFilename(path: string, count: number): string {
  const basename = path.split('/').pop() || 'document'
  return `${count} comment${count === 1 ? '' : 's'} on ${basename}`
}
