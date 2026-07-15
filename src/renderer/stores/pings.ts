// "Ping when done": per-row opt-in chime for Navigator activity rows. An armed
// row plays a subtle bong when its status settles out of working (done, needs
// input, or error) and keeps its ping across runs — only the user unsets it.
// `settled` records a fired ping so rows can show a prominent outcome tag
// until the row is opened.
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useRunsStore, type RunStatus } from './runs.js'
import { playPingSound } from '../services/pingSound.js'

export type PingOutcome = 'done' | 'input' | 'error'

const STORAGE_KEY = 'mim:ping-when-done'
// Armed keys survive restarts; the cap keeps keys for rows deleted elsewhere
// from accumulating forever.
const MAX_ARMED = 200

export function pingOutcome(prev: RunStatus | undefined, next: RunStatus): PingOutcome | null {
  if (prev !== 'working' || next === 'working') return null
  if (next === 'waiting') return null
  if (next === 'error' || next === 'missing') return 'error'
  if (next === 'needs-input' || next === 'needs-approval' || next === 'paused') return 'input'
  return 'done'
}

function loadArmed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

export const usePingsStore = defineStore('pings', () => {
  const runsStore = useRunsStore()
  const armed = ref<Set<string>>(new Set(loadArmed()))
  const settled = ref<Map<string, PingOutcome>>(new Map())

  function saveArmed() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...armed.value]))
    } catch {
      // localStorage may be unavailable
    }
  }

  // Keys match ActivityRow keys: `chat:<sessionId>`, `package:<runId>`,
  // `agent:<sessionId>` — the NavigatorRun ids the runs store already emits.
  let prevStatuses = new Map<string, RunStatus>()

  watch(
    () => runsStore.allRuns.map(run => [run.id, run.status] as const),
    (pairs) => {
      const next = new Map(pairs)
      let fired = false
      for (const key of armed.value) {
        const status = next.get(key)
        if (!status) continue
        // A new run on the same row re-arms the indicator.
        if (status === 'working') settled.value.delete(key)
        const outcome = pingOutcome(prevStatuses.get(key), status)
        if (outcome) {
          settled.value.set(key, outcome)
          fired = true
        }
      }
      // One chime per flush — simultaneous settles should not stack volume.
      if (fired) playPingSound()
      prevStatuses = next
    },
  )

  function isArmed(key: string): boolean {
    return armed.value.has(key)
  }

  function toggle(key: string) {
    if (armed.value.has(key)) {
      armed.value.delete(key)
      settled.value.delete(key)
    } else {
      armed.value.add(key)
      while (armed.value.size > MAX_ARMED) {
        const oldest = armed.value.values().next().value
        if (oldest === undefined) break
        armed.value.delete(oldest)
        settled.value.delete(oldest)
      }
    }
    saveArmed()
  }

  function settledOutcome(key: string): PingOutcome | null {
    return settled.value.get(key) ?? null
  }

  function clearSettled(key: string) {
    settled.value.delete(key)
  }

  return { armed, settled, isArmed, toggle, settledOutcome, clearSettled }
})
