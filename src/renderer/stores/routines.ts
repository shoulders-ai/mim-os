import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface RoutineDefinition {
  id: string
  name: string
  description?: string
  trigger?: Record<string, unknown>
  tools?: string[]
  approvalAllow?: string[]
  body?: string
  enabled: boolean
  paused: boolean
  needsEnablement: boolean
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

export const useRoutineStore = defineStore('routines', () => {
  const routines = ref<RoutineDefinition[]>([])
  const diagnostics = ref<RoutineDiagnostic[]>([])
  const loading = ref(false)
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
    }
  }

  async function runNow(name: string): Promise<RoutineRunResult> {
    if (runningIds.value.has(name)) throw new Error(`Routine is already running: ${name}`)
    runningIds.value = new Set([...runningIds.value, name])
    try {
      return await window.kernel.call('routine.run', { name }) as RoutineRunResult
    } finally {
      const next = new Set(runningIds.value)
      next.delete(name)
      runningIds.value = next
    }
  }

  async function resume(name: string): Promise<void> {
    const result = await window.kernel.call('routine.resume', { name }) as { routine?: RoutineDefinition }
    updateRoutine(result.routine)
  }

  async function pause(name: string): Promise<void> {
    const result = await window.kernel.call('routine.pause', { name }) as { routine?: RoutineDefinition }
    updateRoutine(result.routine)
  }

  function updateRoutine(routine: RoutineDefinition | undefined): void {
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
    error,
    runningIds,
    load,
    runNow,
    resume,
    pause,
    isRunning,
  }
})
