// Human relative time for archive cards and session rows: "just now", "5m ago",
// "3h ago", "2d ago", "3w ago", then an absolute date for anything older.
export function relativeTime(value: string, now: number = Date.now()): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return ''

  const seconds = Math.max(0, Math.floor((now - t) / 1000))
  if (seconds < 45) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`

  const date = new Date(t)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
