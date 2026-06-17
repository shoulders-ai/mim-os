<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle } from '@tabler/icons-vue'
import { flattenTree, type SpanNode } from '../../services/trace/spans'
import { formatDuration, spanLabel } from '../../services/trace/narrate'
import { spanIcon } from './spanVisuals'

const props = defineProps<{
  roots: SpanNode[]
  selectedSpanId: string
  runStart: number
  runDuration: number
}>()

const emit = defineEmits<{ select: [spanId: string] }>()

const rows = computed(() => flattenTree(props.roots))

// Bar geometry, as percentages of the run window. Point events (no duration)
// render as a thin marker so they stay visible without implying a span length.
function bar(node: SpanNode): { left: string; width: string } {
  const total = props.runDuration > 0 ? props.runDuration : 1
  const offset = Math.max(0, Date.parse(node.startedAt) - props.runStart)
  const left = Math.min(100, (offset / total) * 100)
  const raw = node.durationMs !== undefined ? (node.durationMs / total) * 100 : 0
  const width = Math.max(raw, 1.5)
  return { left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }
}

function indent(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${depth * 14}px` }
}

function cost(node: SpanNode): string {
  const value = typeof node.data.estimatedCost === 'number' ? node.data.estimatedCost : 0
  if (!value) return ''
  return value < 0.01 ? '<$0.01' : `$${value.toFixed(value < 1 ? 4 : 2)}`
}

function tokens(node: SpanNode): string {
  const value = typeof node.data.totalTokens === 'number' ? node.data.totalTokens : 0
  return value ? `${new Intl.NumberFormat('en-US').format(value)} tok` : ''
}
</script>

<template>
  <div class="min-h-0 overflow-y-auto overscroll-contain" data-testid="span-tree">
    <div class="divide-y divide-rule-light">
      <button
        v-for="node in rows"
        :key="node.spanId"
        type="button"
        class="grid w-full grid-cols-[minmax(140px,1.4fr)_minmax(0,2fr)_auto] items-center gap-3 px-3 py-1.5 text-left hover:bg-chrome-mid"
        :class="node.spanId === selectedSpanId ? 'bg-accent-tint' : ''"
        :title="spanLabel(node)"
        @click="emit('select', node.spanId)"
      >
        <span class="flex min-w-0 items-center gap-2" :style="indent(node.depth)">
          <component
            :is="spanIcon(node)"
            v-if="!node.error"
            :size="14"
            :stroke="1.8"
            class="shrink-0 text-ink-4"
          />
          <IconAlertTriangle v-else :size="14" :stroke="1.8" class="shrink-0 text-red-600 dark:text-red-300" />
          <span class="truncate text-[11.5px]" :class="node.error ? 'text-red-700 dark:text-red-300' : 'text-ink-2'">
            {{ spanLabel(node) }}
          </span>
        </span>

        <span class="relative h-1.5 w-full rounded-full bg-rule-light">
          <span
            class="absolute inset-y-0 rounded-full"
            :class="node.error ? 'bg-red-500/70' : 'bg-ink-3/60'"
            :style="bar(node)"
          />
        </span>

        <span class="flex min-w-[96px] items-center justify-end gap-2 font-mono text-[10px] text-ink-4">
          <span v-if="tokens(node)" class="truncate">{{ tokens(node) }}</span>
          <span v-if="cost(node)" class="truncate">{{ cost(node) }}</span>
          <span v-if="node.durationMs !== undefined" class="text-ink-3">{{ formatDuration(node.durationMs) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
