import type { RoutineDefinition } from '../../stores/routines.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export type RoutineHealth = 'never-run' | 'succeeded' | 'failed'

export function routineTriggerLabel(routine: RoutineDefinition): string {
  const trigger = routine.trigger ?? {}
  if (typeof trigger.every === 'string') return intervalLabel(trigger.every)
  if (typeof trigger.schedule === 'string') return scheduleLabel(trigger.schedule)
  if (isPlainObject(trigger.files) && typeof trigger.files.path === 'string') {
    return `When ${trigger.files.path} changes`
  }
  if (isPlainObject(trigger.webhook)) return 'On external request'
  if (isPlainObject(trigger.slack)) {
    const channels = Array.isArray(trigger.slack.channels) ? trigger.slack.channels.length : 0
    return channels === 1 ? 'On Slack message' : channels > 1 ? `On Slack message · ${channels} channels` : 'On Slack message'
  }
  return 'Manual'
}

export function routineActivationLabel(routine: RoutineDefinition): string {
  if (routine.activation === 'active') return 'Active'
  if (routine.activation === 'disabled') return 'Automatic runs off'
  if (routine.activation === 'review-required') return 'Review required'
  return 'Manual'
}

export function routineAccessSummary(routine: RoutineDefinition): string {
  if (!routine.tools.length) return 'Default access'
  const tools = `${routine.tools.length} tool${routine.tools.length === 1 ? '' : 's'}`
  if (!routine.approvalAllow.length) return `${tools} · asks before changes`
  const grants = `${routine.approvalAllow.length} allowed without asking`
  return `${tools} · ${grants}`
}

export function routineHealth(routine: RoutineDefinition): RoutineHealth {
  const success = timestamp(routine.lastSuccessAt)
  const error = timestamp(routine.lastErrorAt)
  if (!success && !error) return 'never-run'
  return error > success ? 'failed' : 'succeeded'
}

export function sortRoutinesForAttention(routines: RoutineDefinition[]): RoutineDefinition[] {
  return [...routines].sort((a, b) => {
    const rank = routineRank(a) - routineRank(b)
    if (rank !== 0) return rank
    if (a.activation === 'active' && b.activation === 'active') {
      const next = timestamp(a.nextRunAt) - timestamp(b.nextRunAt)
      if (next !== 0) return next
    }
    return a.name.localeCompare(b.name)
  })
}

export function routineLastEventLabel(routine: RoutineDefinition): string {
  const health = routineHealth(routine)
  if (health === 'never-run') return 'Not run yet'
  const at = health === 'failed' ? routine.lastErrorAt : routine.lastSuccessAt
  return `${health === 'failed' ? 'Failed' : 'Completed'} ${formatRoutineDate(at)}`
}

export function routineNextEventLabel(routine: RoutineDefinition): string {
  if (routine.activation === 'manual') return 'Ready to run'
  if (routine.activation === 'review-required') return 'Review before automatic runs begin'
  if (routine.activation === 'disabled') return 'Automatic runs are off'
  if (routine.nextRunAt) return `Next ${formatRoutineDate(routine.nextRunAt)}`
  const trigger = routine.trigger ?? {}
  if (trigger.files) return 'Waiting for a file change'
  if (trigger.webhook) return 'Waiting for an external request'
  if (trigger.slack) return 'Waiting for a Slack message'
  return 'Automatic runs are active'
}

function routineRank(routine: RoutineDefinition): number {
  if (routineHealth(routine) === 'failed') return 0
  if (routine.activation === 'review-required') return 1
  if (routine.activation === 'active') return 2
  if (routine.activation === 'manual') return 3
  return 4
}

function intervalLabel(value: string): string {
  const match = /^(\d+)([mhd])$/.exec(value.trim())
  if (!match) return `Every ${value}`
  const amount = Number(match[1])
  const unit = match[2] === 'm' ? 'minute' : match[2] === 'h' ? 'hour' : 'day'
  return `Every ${amount} ${unit}${amount === 1 ? '' : 's'}`
}

function scheduleLabel(value: string): string {
  const [minute, hour, day, month, weekday] = value.trim().split(/\s+/)
  if ([minute, hour, day, month, weekday].some(part => part === undefined)) return 'Scheduled'
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (day === '*' && month === '*' && weekday === '*') return `Daily at ${time}`
  if (day === '*' && month === '*' && /^\d$/.test(weekday)) {
    return `${WEEKDAYS[Number(weekday) % 7]} at ${time}`
  }
  return 'Scheduled'
}

function formatRoutineDate(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timestamp(value: string | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
