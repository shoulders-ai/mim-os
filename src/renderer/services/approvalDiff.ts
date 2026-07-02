import type { ApprovalRequest } from '../stores/approvals.js'
import { findTextMatches } from '@main/search/textMatch.js'

export interface ApprovalDiff {
  path: string
  original: string
  modified: string
  kind: 'edit' | 'write' | 'create' | 'delete'
  // Edits only: how many places old_text matches. fs.edit requires exactly 1;
  // anything else means the preview shows no change and the tool will fail.
  matchCount?: number
}

export type ReadFile = (path: string) => Promise<string | null>

// Mirror fs.edit: use the same tolerant matcher and only preview a replacement
// when the tool would have exactly one match.
function applyEdit(content: string, oldText: string, newText: string): { modified: string; matchCount: number } {
  const matches = findTextMatches(content, oldText)
  if (matches.length !== 1) return { modified: content, matchCount: matches.length }
  const match = matches[0]
  return {
    modified: content.slice(0, match.index) + newText + content.slice(match.index + match.length),
    matchCount: 1,
  }
}

function requestPath(request: ApprovalRequest): string {
  const path = request.params?.path
  if (typeof path === 'string') return path
  return request.target ?? ''
}

// Resolve the before/after the user will see in the diff panel. `readFile` reads
// the current on-disk content (null when the file does not exist yet). The change
// has not happened — the gate fires before the write — so "original" is the live
// file and "modified" is what the action would produce.
export async function buildApprovalDiff(request: ApprovalRequest, readFile: ReadFile): Promise<ApprovalDiff | null> {
  const preview = request.preview
  if (!preview) return null
  const path = requestPath(request)

  if (preview.kind === 'create') {
    return { path, original: '', modified: preview.content ?? '', kind: 'create' }
  }
  if (preview.kind === 'write') {
    const original = (await readFile(path)) ?? ''
    return { path, original, modified: preview.content ?? '', kind: 'write' }
  }
  if (preview.kind === 'delete') {
    const original = (await readFile(path)) ?? ''
    return { path, original, modified: '', kind: 'delete' }
  }
  // edit
  const original = (await readFile(path)) ?? ''
  const { modified, matchCount } = applyEdit(original, preview.oldText ?? '', preview.newText ?? '')
  return { path, original, modified, kind: 'edit', matchCount }
}

// An edit that fs.edit would reject previews as an empty diff, which reads as
// "harmless". Say why the diff is empty so nobody approves on a false premise.
export function approvalDiffNotice(diff: ApprovalDiff): string | undefined {
  if (diff.kind !== 'edit' || diff.matchCount == null || diff.matchCount === 1) return undefined
  if (diff.matchCount === 0) return 'No match found — this edit will fail as written.'
  return `Matches ${diff.matchCount} places — this edit will fail as written.`
}
