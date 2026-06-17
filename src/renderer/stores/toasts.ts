import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export interface Toast {
  id: number
  kind: 'error' | 'info'
  message: string
  detail?: string
  actionLabel?: string
  action?: () => void
}

const AUTO_DISMISS_MS = 6000

export const useToastStore = defineStore('toasts', () => {
  let nextId = 1
  const items = ref<Toast[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const list = computed(() => items.value)

  function push(toast: Omit<Toast, 'id'>): number {
    const id = nextId++
    items.value.push({ ...toast, id })
    const timer = setTimeout(() => {
      dismiss(id)
    }, AUTO_DISMISS_MS)
    timers.set(id, timer)
    return id
  }

  function dismiss(id: number): void {
    const index = items.value.findIndex(t => t.id === id)
    if (index >= 0) items.value.splice(index, 1)
    const timer = timers.get(id)
    if (timer != null) {
      clearTimeout(timer)
      timers.delete(id)
    }
  }

  function clear(): void {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    items.value = []
  }

  return { list, items, push, dismiss, clear }
})
