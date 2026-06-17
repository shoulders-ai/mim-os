import type { ApprovalRequest } from '../stores/approvals.js'

export interface ApprovalDiff {
  path: string
  original: string
  modified: string
  kind: 'edit' | 'write' | 'create' | 'delete'
}

export type ReadFile = (path: string) => Promise<string | null>

// Mirror fs.edit: replace the first occurrence of oldText. The gate already
// guarantees exactly one match before the write runs, so the preview matches the
// real outcome.
function applyEdit(content: string, oldText: string, newText: string): string {
  const index = content.indexOf(oldText)
  if (index < 0) return content
  return content.slice(0, index) + newText + content.slice(index + oldText.length)
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
  const modified = applyEdit(original, preview.oldText ?? '', preview.newText ?? '')
  return { path, original, modified, kind: 'edit' }
}
