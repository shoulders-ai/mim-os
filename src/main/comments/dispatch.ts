import {
  addComment,
  appendCommentReply,
  parseComments,
  resolveAllComments,
  resolveComment,
  type AddCommentInput,
  type CommentThread,
  type ReplyInput,
} from '@main/comments/model.js'
import {
  addCodeComment,
  appendCodeCommentReply,
  commentPrefixForPath,
  parseCodeComments,
  resolveAllCodeComments,
  resolveCodeComment,
  supportsCodeCommentPath,
} from '@main/comments/codeModel.js'

/**
 * Path-aware entry points over the two comment models: markdown files use
 * inline <comment> wrappers, code/plain-text files use @mim line markers.
 * Tools and the AI runtime route through here so one call surface covers
 * every commentable file type.
 */

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])

export function isMarkdownCommentPath(path: string): boolean {
  const basename = (path.split('/').pop() || '').toLowerCase()
  const dot = basename.lastIndexOf('.')
  return dot >= 0 && MARKDOWN_EXTENSIONS.has(basename.slice(dot + 1))
}

export function supportsCommentPath(path: string): boolean {
  return isMarkdownCommentPath(path) || supportsCodeCommentPath(path)
}

export function parseCommentsForPath(raw: string, path: string): CommentThread[] {
  return isMarkdownCommentPath(path) ? parseComments(raw) : parseCodeComments(raw)
}

export function addCommentForPath(raw: string, path: string, input: AddCommentInput): { text: string; thread: CommentThread } {
  if (isMarkdownCommentPath(path)) return addComment(raw, input)
  const prefix = commentPrefixForPath(path)
  if (!prefix) throw new Error(`Inline comments are not supported for this file type: ${path}`)
  return addCodeComment(raw, { ...input, prefix })
}

export function replyCommentForPath(raw: string, path: string, input: ReplyInput): { text: string; thread: CommentThread } {
  return isMarkdownCommentPath(path) ? appendCommentReply(raw, input) : appendCodeCommentReply(raw, input)
}

export function resolveCommentForPath(raw: string, path: string, id: string): { text: string; anchor: string } {
  return isMarkdownCommentPath(path) ? resolveComment(raw, id) : resolveCodeComment(raw, id)
}

export function resolveAllCommentsForPath(raw: string, path: string): { text: string; count: number } {
  return isMarkdownCommentPath(path) ? resolveAllComments(raw) : resolveAllCodeComments(raw)
}
