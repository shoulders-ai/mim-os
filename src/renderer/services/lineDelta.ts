export interface LineDelta {
  added: number
  removed: number
}

// LCS is O(n·m); above this the exact count is not worth the stall, so callers
// get null and decide their own fallback (estimate, or hide the indicator).
const MAX_LINES = 2000

// Longest-common-subsequence length over lines, with a rolling row to keep
// memory bounded.
function lcsLength(a: string[], b: string[]): number {
  let prev: number[] = new Array(b.length + 1).fill(0)
  for (let i = a.length - 1; i >= 0; i--) {
    const cur: number[] = new Array(b.length + 1).fill(0)
    for (let j = b.length - 1; j >= 0; j--) {
      cur[j] = a[i] === b[j] ? prev[j + 1] + 1 : Math.max(prev[j], cur[j + 1])
    }
    prev = cur
  }
  return prev[0]
}

export function lineDelta(oldText: string, newText: string): LineDelta | null {
  const a = oldText ? oldText.split('\n') : []
  const b = newText ? newText.split('\n') : []
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null
  const common = lcsLength(a, b)
  return { added: b.length - common, removed: a.length - common }
}
