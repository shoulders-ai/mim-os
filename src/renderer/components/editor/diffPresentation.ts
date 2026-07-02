import type { DiffReviewMeta } from '../../stores/diff.js'

export function shouldCollapseUnchangedDiffSections(reviewMeta: DiffReviewMeta | null | undefined): boolean {
  return reviewMeta?.type === 'approval'
}

// After a per-chunk accept/reject, the reviewer's eyes stay where the resolved
// chunk was: advance to the chunk covering that document position, or the next
// one below it, or the last remaining one.
export function nextChunkIndexFromPos(
  chunks: ReadonlyArray<{ fromB: number; toB: number }>,
  pos: number,
): number {
  if (chunks.length === 0) return -1
  const index = chunks.findIndex(chunk => chunk.toB > pos)
  return index === -1 ? chunks.length - 1 : index
}
