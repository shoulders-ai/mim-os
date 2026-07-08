<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { IconPlayerPause, IconPlayerPlay, IconRefresh } from '@tabler/icons-vue'
import { useRoutineStore, type RoutineDefinition } from '../../stores/routines.js'

const props = withDefaults(defineProps<{
  active?: boolean
}>(), {
  active: true,
})

const emit = defineEmits<{
  openSession: [id: string]
}>()

const store = useRoutineStore()

const sortedRoutines = computed(() =>
  [...store.routines].sort((a, b) => a.name.localeCompare(b.name)),
)

onMounted(() => {
  if (props.active) void store.load()
})

watch(() => props.active, active => {
  if (active) void store.load()
})

function triggerLabel(routine: RoutineDefinition): string {
  const trigger = routine.trigger ?? {}
  if (typeof trigger.every === 'string') return `Every ${trigger.every}`
  if (typeof trigger.schedule === 'string') return `Schedule ${trigger.schedule}`
  if (isPlainObject(trigger.files) && typeof trigger.files.path === 'string') return `Files ${trigger.files.path}`
  if (isPlainObject(trigger.webhook) && typeof trigger.webhook.secret === 'string') return `Webhook ${trigger.webhook.secret}`
  if (isPlainObject(trigger.slack)) return 'Slack'
  return 'Manual'
}

function routineTools(routine: RoutineDefinition): string {
  return routine.tools?.length ? routine.tools.join(', ') : 'Default tools'
}

async function runNow(routine: RoutineDefinition): Promise<void> {
  const result = await store.runNow(routine.id)
  if (result.sessionId) emit('openSession', result.sessionId)
}

async function toggleEnabled(routine: RoutineDefinition): Promise<void> {
  if (routine.enabled) await store.pause(routine.id)
  else await store.resume(routine.id)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
</script>

<template>
  <main class="flex h-full min-h-0 flex-col bg-surface text-ink">
    <header class="flex h-11 shrink-0 items-center justify-between border-b border-rule-light px-4">
      <div class="min-w-0">
        <h1 class="truncate text-[13px] font-semibold">Routines</h1>
      </div>
      <button
        class="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        title="Refresh"
        aria-label="Refresh"
        @click="store.load"
      >
        <IconRefresh :size="15" :stroke="1.8" />
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div v-if="store.error" class="mb-3 rounded-[7px] border border-rem/30 bg-rem/10 px-3 py-2 text-[12px] text-rem">
        {{ store.error }}
      </div>

      <div v-if="store.diagnostics.length" class="mb-3 rounded-[7px] border border-warn/30 bg-warn/10 px-3 py-2">
        <div
          v-for="diagnostic in store.diagnostics"
          :key="`${diagnostic.path}:${diagnostic.message}`"
          class="text-[12px] text-ink-2"
        >
          {{ diagnostic.path }}: {{ diagnostic.message }}
        </div>
      </div>

      <div v-if="sortedRoutines.length" class="flex flex-col gap-2">
        <section
          v-for="routine in sortedRoutines"
          :key="routine.id"
          class="rounded-[7px] border border-rule-light bg-chrome px-3 py-3"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <h2 class="truncate text-[13px] font-semibold">{{ routine.name }}</h2>
                <span
                  class="shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[10px] font-medium"
                  :class="routine.enabled ? 'border-accent/30 bg-accent-tint text-accent' : 'border-rule-light bg-chrome-mid text-ink-3'"
                >
                  {{ routine.enabled ? 'Enabled' : routine.paused ? 'Paused' : 'Disabled' }}
                </span>
              </div>
              <p v-if="routine.description" class="mt-1 text-[12px] text-ink-3">
                {{ routine.description }}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
                <span class="rounded-[5px] bg-chrome-mid px-1.5 py-0.5">{{ triggerLabel(routine) }}</span>
                <span class="rounded-[5px] bg-chrome-mid px-1.5 py-0.5">{{ routineTools(routine) }}</span>
                <span v-if="routine.nextRunAt" class="rounded-[5px] bg-chrome-mid px-1.5 py-0.5">
                  Next {{ new Date(routine.nextRunAt).toLocaleString() }}
                </span>
              </div>
              <p v-if="routine.body" class="mt-3 line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 text-ink-2">
                {{ routine.body }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                data-testid="routine-run-now"
                class="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                :class="store.isRunning(routine.id) ? 'opacity-55' : ''"
                title="Run now"
                :disabled="store.isRunning(routine.id)"
                @click="runNow(routine)"
              >
                <IconPlayerPlay :size="14" :stroke="1.8" />
                <span>{{ store.isRunning(routine.id) ? 'Running' : 'Run' }}</span>
              </button>
              <button
                :data-testid="routine.enabled ? 'routine-pause' : 'routine-resume'"
                class="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                :title="routine.enabled ? 'Pause' : 'Resume'"
                @click="toggleEnabled(routine)"
              >
                <IconPlayerPause v-if="routine.enabled" :size="14" :stroke="1.8" />
                <IconPlayerPlay v-else :size="14" :stroke="1.8" />
                <span>{{ routine.enabled ? 'Pause' : 'Resume' }}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="!store.loading" class="px-1 py-2 text-[12px] text-ink-4">
        No routines
      </div>
    </div>
  </main>
</template>
