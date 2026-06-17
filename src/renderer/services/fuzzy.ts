// Lightweight fuzzy matcher + file ranker for the Files Work surface search.
// No external dependency — a small greedy scorer with boundary/consecutive
// bonuses, good enough to rank a workspace's worth of file paths and to
// highlight the matched characters.

export interface FuzzyMatch {
  /** Higher is better. */
  score: number
  /** Indices into the target string that matched, in order. */
  positions: number[]
}

const CONSECUTIVE_BONUS = 16
const BOUNDARY_BONUS = 10
const FIRST_CHAR_BONUS = 6
const MAX_GAP_PENALTY = 3
const MAX_LEAD_PENALTY = 10
const LEAD_WEIGHT = 0.5

const SEPARATORS = /[\\/\-_. ]/

// A character is at a "boundary" if it starts the string, follows a separator,
// or is a camelCase hump (lower→Upper). Uses the original-cased target.
function isBoundary(target: string, i: number): boolean {
  if (i === 0) return true
  const prev = target[i - 1]
  if (SEPARATORS.test(prev)) return true
  const ch = target[i]
  return prev === prev.toLowerCase() && ch === ch.toUpperCase() && ch !== ch.toLowerCase()
}

/**
 * Greedy left-to-right fuzzy match. Returns null when `query` does not match.
 * An empty query trivially matches with score 0 and no positions.
 */
export function fuzzyScore(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  const positions: number[] = []
  let score = 0
  let prevIdx = -1
  let cursor = 0

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let i = cursor; i < t.length; i++) {
      if (t[i] === ch) { found = i; break }
    }
    if (found === -1) return null

    positions.push(found)
    score += 1
    if (prevIdx !== -1) {
      if (found === prevIdx + 1) score += CONSECUTIVE_BONUS
      else score -= Math.min(found - prevIdx - 1, MAX_GAP_PENALTY)
    }
    if (isBoundary(target, found)) score += BOUNDARY_BONUS
    if (found === 0) score += FIRST_CHAR_BONUS

    prevIdx = found
    cursor = found + 1
  }

  // Prefer matches that start nearer the front of the target.
  score -= Math.min(positions[0], MAX_LEAD_PENALTY) * LEAD_WEIGHT
  return { score, positions }
}

export interface RankableFile {
  path: string
  name: string
  dir?: string
}

export interface RankedFile<T extends RankableFile = RankableFile> {
  file: T
  score: number
  /** Positions to highlight in the file *name* (empty when only the path matched). */
  positions: number[]
  matchedName: boolean
}

// Filename matches should generally outrank path-only matches.
const NAME_BONUS = 15
// Recent files get nudged up; the array is most-recent-first.
const RECENCY_WEIGHT = 4

/**
 * Rank files against a query. Scores the filename and the full path, keeps the
 * better of the two, and adds a small recency boost for paths in `recentPaths`.
 * Returns matches only, best first, capped to `limit`.
 */
export function rankFiles<T extends RankableFile>(
  query: string,
  files: T[],
  recentPaths: string[] = [],
  limit = 50,
): RankedFile<T>[] {
  const q = query.trim()
  if (!q) return []

  const recencyRank = new Map<string, number>()
  recentPaths.forEach((p, i) => recencyRank.set(p, recentPaths.length - i))

  const out: RankedFile<T>[] = []
  for (const file of files) {
    const nameMatch = fuzzyScore(q, file.name)
    const pathMatch = fuzzyScore(q, file.path)
    if (!nameMatch && !pathMatch) continue

    let score = -Infinity
    let positions: number[] = []
    let matchedName = false

    if (nameMatch) {
      score = nameMatch.score + NAME_BONUS
      positions = nameMatch.positions
      matchedName = true
    }
    if (pathMatch && pathMatch.score > score) {
      score = pathMatch.score
      positions = pathMatch.positions
      matchedName = false
    }

    const boost = (recencyRank.get(file.path) ?? 0) * RECENCY_WEIGHT
    out.push({ file, score: score + boost, positions, matchedName })
  }

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
