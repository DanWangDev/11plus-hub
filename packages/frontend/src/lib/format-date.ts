const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Never'
  const then = new Date(iso)
  const t = then.getTime()
  if (Number.isNaN(t)) return 'Never'

  const diff = now.getTime() - t
  if (diff < 0) return formatAbsolute(iso)
  if (diff < 45 * SECOND) return 'just now'
  if (diff < 90 * SECOND) return '1 min ago'
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`
  if (diff < 2 * HOUR) return '1 hour ago'
  if (diff < DAY) return `${Math.round(diff / HOUR)} hours ago`
  if (diff < 2 * DAY) return 'yesterday'
  if (diff < WEEK) return `${Math.round(diff / DAY)} days ago`
  return formatAbsolute(iso)
}

export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
