import type { ApprovalPreviewLike } from './approvalLogic.js'
import { lineDelta } from '../../services/lineDelta.js'

// A plain-language description of a file change, derived deterministically from
// the change itself. It states magnitude and nature only — never meaning — so it
// can't give false comfort on an approval surface. The real diff lives behind
// "Review change".

function lineCount(text: string): number {
  if (!text) return 0
  return text.replace(/\n$/, '').split('\n').length
}

function lines(n: number): string {
  return `${n} ${n === 1 ? 'line' : 'lines'}`
}

// Edit previews are the changed region (not whole files), so inputs stay small;
// very large inputs (lineDelta null) fall back to a length-based estimate.
function editDelta(oldText: string, newText: string): { added: number; removed: number } {
  const exact = lineDelta(oldText, newText)
  if (exact) return exact
  return {
    added: newText ? newText.split('\n').length : 0,
    removed: oldText ? oldText.split('\n').length : 0,
  }
}

export function changeSummary(preview?: ApprovalPreviewLike | null): string {
  if (!preview) return ''

  if (preview.kind === 'create') {
    const n = lineCount(preview.content ?? '')
    return n ? `Creates a new file (${lines(n)}).` : 'Creates an empty file.'
  }
  if (preview.kind === 'delete') {
    return 'Deletes this file.'
  }
  if (preview.kind === 'write') {
    const n = lineCount(preview.content ?? '')
    return n ? `Overwrites the file (${lines(n)}).` : 'Clears the file.'
  }

  // edit
  const { added, removed } = editDelta(preview.oldText ?? '', preview.newText ?? '')
  if (!added && !removed) return ''
  if (added && !removed) return `Adds ${lines(added)}.`
  if (removed && !added) return `Removes ${lines(removed)}.`
  if (added === removed) return `Rewrites ${lines(added)}.`
  return `Replaces ${lines(removed)} with ${added}.`
}
