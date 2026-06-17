import type { ApprovalPreviewLike } from './approvalLogic.js'

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

// Longest-common-subsequence length over lines, with a rolling row to keep memory
// bounded. Edit previews are the changed region (not whole files), so inputs stay
// small; very large inputs fall back to a length-based estimate.
function lcsLength(a: string[], b: string[]): number {
  let prev = new Array(b.length + 1).fill(0)
  for (let i = a.length - 1; i >= 0; i--) {
    const cur = new Array(b.length + 1).fill(0)
    for (let j = b.length - 1; j >= 0; j--) {
      cur[j] = a[i] === b[j] ? prev[j + 1] + 1 : Math.max(prev[j], cur[j + 1])
    }
    prev = cur
  }
  return prev[0]
}

function lineDelta(oldText: string, newText: string): { added: number; removed: number } {
  const a = oldText ? oldText.split('\n') : []
  const b = newText ? newText.split('\n') : []
  if (a.length > 2000 || b.length > 2000) {
    return { added: b.length, removed: a.length }
  }
  const common = lcsLength(a, b)
  return { added: b.length - common, removed: a.length - common }
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
  const { added, removed } = lineDelta(preview.oldText ?? '', preview.newText ?? '')
  if (!added && !removed) return ''
  if (added && !removed) return `Adds ${lines(added)}.`
  if (removed && !added) return `Removes ${lines(removed)}.`
  if (added === removed) return `Rewrites ${lines(added)}.`
  return `Replaces ${lines(removed)} with ${added}.`
}
