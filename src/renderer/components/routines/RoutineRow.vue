<script setup lang="ts">
import {
  IconBolt,
  IconCopy,
  IconDots,
  IconFileText,
  IconPencil,
  IconPlayerPlay,
  IconTrash,
} from '@tabler/icons-vue'
import type { RoutineDefinition } from '../../stores/routines.js'
import MimMenu from '../ui/MimMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import MimToggle from '../ui/MimToggle.vue'
import {
  routineAccessSummary,
  routineActivationLabel,
  routineHealth,
  routineLastEventLabel,
  routineNextEventLabel,
  routineTriggerLabel,
} from './routinePresentation.js'

const props = withDefaults(defineProps<{
  routine: RoutineDefinition
  sourceLabel?: string
  running?: boolean
  hasLastRun?: boolean
}>(), {
  running: false,
  hasLastRun: false,
  sourceLabel: '',
})

const emit = defineEmits<{
  run: []
  edit: []
  review: []
  disable: []
  openFile: []
  openLastRun: []
  duplicate: []
  remove: []
}>()

function toggleAutomation(): void {
  if (props.routine.activation === 'active') emit('disable')
  else emit('review')
}
</script>

<template>
  <article
    class="group border-b border-rule-light px-3 py-3 hover:bg-chrome-mid"
    :data-routine-id="routine.id"
  >
    <div class="flex items-start gap-3">
      <div
        class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border"
        :class="[
          routine.activation === 'active' ? 'border-accent/30 bg-accent-tint text-accent' : 'border-rule-light bg-surface text-ink-3',
          routineHealth(routine) === 'failed' ? 'border-rem/30 bg-rem/10 text-rem' : '',
        ]"
      >
        <IconBolt :size="14" :stroke="1.8" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-start justify-between gap-3">
          <button
            type="button"
            data-testid="routine-edit"
            class="-m-1 min-w-0 flex-1 rounded-[5px] p-1 text-left hover:bg-chrome-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            title="Edit routine"
            @click="emit('edit')"
          >
            <span class="flex min-w-0 items-center gap-2">
              <span class="truncate text-[13px] font-semibold text-ink">
                {{ routine.description || routine.name }}
              </span>
              <span
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                :class="{
                  'bg-accent-tint text-accent': routine.activation === 'active',
                  'bg-warn/10 text-warn': routine.activation === 'review-required',
                  'bg-chrome-high text-ink-3': routine.activation === 'manual' || routine.activation === 'disabled',
                }"
              >
                {{ routineActivationLabel(routine) }}
              </span>
              <span class="shrink-0 rounded-full bg-chrome-high px-1.5 py-0.5 text-[10px] font-medium text-ink-3">
                {{ sourceLabel || (routine.origin === 'team' ? 'Team' : 'Project') }}
              </span>
            </span>
            <span class="mt-0.5 block truncate font-mono text-[10px] text-ink-4">
              {{ routine.name }}
            </span>
          </button>

          <div class="flex shrink-0 items-center gap-1">
            <div
              v-if="routine.activation !== 'manual'"
              class="mr-1 flex h-7 items-center gap-2 rounded-[5px] px-1.5 hover:bg-chrome-high"
              :title="routine.activation === 'active' ? 'Turn off automatic runs' : 'Review and enable automatic runs'"
            >
              <span class="text-[10px] font-medium text-ink-3">Automatic</span>
              <MimToggle
                :model-value="routine.activation === 'active'"
                data-testid="routine-automatic"
                aria-label="Automatic runs"
                @update:model-value="toggleAutomation"
              />
            </div>

            <button
              type="button"
              data-testid="routine-run"
              class="inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[11px] font-semibold text-ink-2 hover:bg-chrome-high hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
              :disabled="running"
              :title="routine.activation === 'manual' ? 'Run routine' : 'Run routine now'"
              @click="emit('run')"
            >
              <IconPlayerPlay :size="13" :stroke="1.8" />
              <span>{{ running ? 'Running' : routine.activation === 'manual' ? 'Run' : 'Run now' }}</span>
            </button>

            <MimMenu
              placement="bottom-end"
              aria-label="Routine actions"
              title="Routine actions"
              trigger-class="h-7 w-7 justify-center rounded-[5px] text-ink-3 hover:bg-chrome-high hover:text-ink"
              :trigger-attrs="{ 'data-testid': 'routine-actions' }"
              :min-width="190"
            >
              <template #trigger>
                <IconDots :size="15" :stroke="1.8" />
              </template>
              <MimMenuItem :button-attrs="{ 'data-testid': 'routine-menu-edit' }" @select="emit('edit')">
                <IconPencil :size="14" :stroke="1.8" class="text-ink-3" />
                Edit routine
              </MimMenuItem>
              <MimMenuItem @select="emit('openFile')">
                <IconFileText :size="14" :stroke="1.8" class="text-ink-3" />
                Open definition file
              </MimMenuItem>
              <MimMenuItem :disabled="!hasLastRun" @select="emit('openLastRun')">
                <IconPlayerPlay :size="14" :stroke="1.8" class="text-ink-3" />
                View last run
              </MimMenuItem>
              <MimMenuItem @select="emit('duplicate')">
                <IconCopy :size="14" :stroke="1.8" class="text-ink-3" />
                Duplicate
              </MimMenuItem>
              <div class="my-1 border-t border-rule-light" />
              <MimMenuItem danger @select="emit('remove')">
                <IconTrash :size="14" :stroke="1.8" />
                Move to Trash
              </MimMenuItem>
            </MimMenu>
          </div>
        </div>

        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <span>{{ routineTriggerLabel(routine) }}</span>
          <span class="text-ink-4">{{ routineAccessSummary(routine) }}</span>
          <span v-if="routine.owner" class="text-ink-4">Runs on {{ routine.owner }}</span>
        </div>

        <div
          v-if="routine.activation !== 'manual' || routine.lastRunId || routine.lastSuccessAt || routine.lastErrorAt"
          class="mt-2 grid grid-cols-[auto_minmax(24px,1fr)_auto] items-center gap-2 font-mono text-[9.5px] text-ink-4"
        >
          <span
            class="truncate"
            :class="routineHealth(routine) === 'failed' ? 'font-semibold text-rem' : ''"
          >
            {{ routineLastEventLabel(routine) }}
          </span>
          <span class="relative h-px bg-rule-light">
            <span
              class="absolute -left-0.5 -top-[3px] h-[7px] w-[7px] rounded-full border bg-surface"
              :class="routineHealth(routine) === 'failed' ? 'border-rem' : 'border-rule'"
            />
            <span
              class="absolute -right-0.5 -top-[3px] h-[7px] w-[7px] rounded-full border bg-surface"
              :class="routine.activation === 'active' ? 'border-accent' : 'border-rule'"
            />
          </span>
          <span class="truncate text-right">{{ routineNextEventLabel(routine) }}</span>
        </div>
      </div>
    </div>
  </article>
</template>
