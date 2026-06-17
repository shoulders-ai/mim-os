import type { DiffReviewMeta } from '../../stores/diff.js'

export function shouldCollapseUnchangedDiffSections(reviewMeta: DiffReviewMeta | null | undefined): boolean {
  return reviewMeta?.type === 'approval'
}
