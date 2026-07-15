import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface RoutineDefinition {
  id: string
  path: string
  name: string
  description?: string
  trigger?: Record<string, unknown>
  agent?: string
  model?: string
  tools: string[]
  approvalAllow: string[]
  steps?: number
  missed?: 'skip' | 'once'
  body: string
  authorityHash: string
  revision: string
  activation: 'manual' | 'active' | 'disabled' | 'review-required'
  nextRunAt?: string
  lastRunId?: string
  lastSuccessAt?: string
  lastErrorAt?: string
}

export interface RoutineDiagnostic {
  path: string
  routineId?: string
  severity: 'error' | 'warning'
  message: string
}

export interface RoutineRunResult {
  sessionId: string
  routineRunId: string
  status: string
}

export interface CreateRoutineInput {
  name: string
  description?: string
  trigger?: Record<string, unknown>
  agent?: string
  model?: string
  tools?: string[]
  approvalAllow?: string[]
  steps?: number
  missed?: 'skip' | 'once'
  body: string
}

export interface UpdateRoutineInput extends CreateRoutineInput {
  expectedRevision: string
}

export const useRoutineStore = defineStore('routines', () => {
  const routines = ref<RoutineDefinition[]>([])
  const diagnostics = ref<RoutineDiagnostic[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  const runningIds = ref(new Set<string>())

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const result = await window.kernel.call('routine.list') as {
        routines?: RoutineDefinition[]
        diagnostics?: RoutineDiagnostic[]
      }
      routines.value = result.routines ?? []
      diagnostics.value = result.diagnostics ?? []
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
      loaded.value = true
    }
  }

  async function create(input: CreateRoutineInput): Promise<RoutineDefinition | null> {
    const result = await window.kernel.call('routine.create', input) as { routine?: RoutineDefinition }
    upsertRoutine(result.routine)
    return result.routine ?? null
  }

  async function update(input: UpdateRoutineInput): Promise<RoutineDefinition | null> {
    const result = await window.kernel.call('routine.update', input) as { routine?: RoutineDefinition }
    upsertRoutine(result.routine)
    return result.routine ?? null
  }

  async function duplicate(name: string, newName: string): Promise<RoutineDefinition | null> {
    const result = await window.kernel.call('routine.duplicate', { name, newName }) as { routine?: RoutineDefinition }
    upsertRoutine(result.routine)
    return result.routine ?? null
  }

  async function runNow(name: string): Promise<RoutineRunResult> {
    if (runningIds.value.has(name)) throw new Error(`Routine is already running: ${name}`)
    runningIds.value = new Set([...runningIds.value, name])
    try {
      return await window.kernel.call('routine.start', { name }) as RoutineRunResult
    } finally {
      const next = new Set(runningIds.value)
      next.delete(name)
      runningIds.value = next
    }
  }

  async function enable(name: string): Promise<void> {
    const result = await window.kernel.call('routine.enable', { name }) as { routine?: RoutineDefinition }
    upsertRoutine(result.routine)
  }

  async function disable(name: string): Promise<void> {
    const result = await window.kernel.call('routine.disable', { name }) as { routine?: RoutineDefinition }
    upsertRoutine(result.routine)
  }

  async function remove(name: string): Promise<void> {
    await window.kernel.call('routine.remove', { name })
    routines.value = routines.value.filter(item => item.id !== name)
  }

  function upsertRoutine(routine: RoutineDefinition | undefined): void {
    if (!routine?.id) return
    const idx = routines.value.findIndex(item => item.id === routine.id)
    if (idx >= 0) routines.value[idx] = { ...routines.value[idx], ...routine }
    else routines.value.unshift(routine)
  }

  function isRunning(name: string): boolean {
    return runningIds.value.has(name)
  }

  return {
    routines,
    diagnostics,
    loading,
    loaded,
    error,
    runningIds,
    load,
    create,
    update,
    duplicate,
    runNow,
    enable,
    disable,
    remove,
    isRunning,
  }
})
