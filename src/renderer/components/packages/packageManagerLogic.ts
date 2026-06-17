export interface JobInputSchema {
  required?: unknown
  properties?: unknown
}

export interface PackageRunEventLike {
  type: string
  data?: Record<string, unknown>
}

export interface PackageRunLike {
  jobId: string
  status: string
  startedAt?: string
  completedAt?: string
  events?: PackageRunEventLike[]
}

export interface CapabilityJobLike {
  id: string
  concurrency?: string
}

export interface RunProgressSummary {
  value: number
  percent: number
  label: string
}

export function parseJobInputText(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Job inputs must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function defaultInputForSchema(inputSchema?: JobInputSchema): string {
  const required = Array.isArray(inputSchema?.required)
    ? inputSchema.required.filter((item): item is string => typeof item === 'string')
    : []
  const properties = inputSchema?.properties && typeof inputSchema.properties === 'object' && !Array.isArray(inputSchema.properties)
    ? inputSchema.properties as Record<string, Record<string, unknown>>
    : {}
  const input: Record<string, unknown> = {}
  for (const key of required) {
    const schema = properties[key]
    if (schema?.type === 'number' || schema?.type === 'integer') input[key] = 0
    else if (schema?.type === 'boolean') input[key] = false
    else if (schema?.type === 'array') input[key] = []
    else if (schema?.type === 'object') input[key] = {}
    else input[key] = ''
  }
  return JSON.stringify(input, null, 2)
}

export function jobInputSummary(inputSchema?: JobInputSchema): string {
  const required = Array.isArray(inputSchema?.required)
    ? inputSchema.required.filter((item): item is string => typeof item === 'string')
    : []
  if (required.length) return `Requires ${required.join(', ')}`
  if (inputSchema?.properties && typeof inputSchema.properties === 'object') {
    const keys = Object.keys(inputSchema.properties as Record<string, unknown>)
    if (keys.length) return `Accepts ${keys.join(', ')}`
  }
  return 'No declared inputs'
}

export function packageRunEventLabel(event: PackageRunEventLike): string {
  if (event.type === 'job.step' && typeof event.data?.name === 'string') return event.data.name
  if (event.type === 'job.log' && typeof event.data?.message === 'string') return event.data.message
  if (event.type === 'job.progress') {
    const label = typeof event.data?.label === 'string' ? event.data.label : 'Progress'
    const value = typeof event.data?.value === 'number' ? ` ${Math.round(event.data.value * 100)}%` : ''
    return `${label}${value}`
  }
  if (event.type === 'job.done' && typeof event.data?.summary === 'string') return event.data.summary
  if (event.type === 'job.failed' && typeof event.data?.error === 'string') return event.data.error
  return event.type.replace(/^job\./, '')
}

export function latestRunProgress(run: PackageRunLike): RunProgressSummary {
  const event = [...(run.events ?? [])]
    .reverse()
    .find(candidate => candidate.type === 'job.progress' && typeof candidate.data?.value === 'number')
  if (event) {
    const value = clamp(Number(event.data?.value), 0, 1)
    const percent = Math.round(value * 100)
    const label = typeof event.data?.label === 'string' ? event.data.label : 'Progress'
    return { value, percent, label: `${label} ${percent}%` }
  }
  if (run.status === 'completed') return { value: 1, percent: 100, label: 'Complete' }
  if (run.status === 'failed') return { value: 1, percent: 100, label: 'Failed' }
  if (run.status === 'cancelled') return { value: 1, percent: 100, label: 'Cancelled' }
  return { value: 0, percent: 0, label: 'Waiting for progress' }
}

export function latestRunActivity(run: PackageRunLike): string {
  const event = [...(run.events ?? [])]
    .reverse()
    .find(candidate => candidate.type !== 'job.started')
  if (event?.type === 'job.progress') return latestRunProgress(run).label
  if (event) return packageRunEventLabel(event)
  return latestRunProgress(run).label
}

export function runDurationLabel(run: PackageRunLike, now = Date.now()): string {
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : Number.NaN
  if (Number.isNaN(startedAt)) return ''
  const completedAt = run.completedAt ? Date.parse(run.completedAt) : now
  const elapsedSeconds = Math.max(0, Math.round((completedAt - startedAt) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function activeRunForJob<T extends PackageRunLike>(
  job: CapabilityJobLike,
  runs: T[],
): T | null {
  if (job.concurrency === 'parallel') return null
  return runs.find(run => run.jobId === job.id && run.status === 'running') ?? null
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
