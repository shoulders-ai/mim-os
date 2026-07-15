<script setup>
import { computed } from 'vue'

const props = defineProps({
  percent: { type: Number, default: 0 },
  size: { type: Number, default: 16 },
  tokenCount: { type: Number, default: 0 },
  contextWindow: { type: Number, default: 0 },
  costLabel: { type: String, default: '' },
  compacted: { type: Boolean, default: false },
  compactionTokensBefore: { type: Number, default: 0 },
  compactionTokensAfter: { type: Number, default: 0 },
})

const radius = computed(() => Math.max(4, (props.size - 4) / 2))
const center = computed(() => props.size / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const clampedPercent = computed(() => Math.max(0, Math.min(1, props.percent)))
const dashOffset = computed(() => circumference.value * (1 - clampedPercent.value))

const strokeClass = computed(() => {
  if (clampedPercent.value > 0.85) return 'text-rem'
  if (clampedPercent.value > 0.6) return 'text-accent'
  return 'text-ink-4'
})

const tooltip = computed(() => {
  const pct = Math.round(clampedPercent.value * 100)
  const tokens = formatTokens(props.tokenCount)
  const context = formatTokens(props.contextWindow)
  const parts = [`Context: ${tokens} / ${context} (${pct}%)`]
  if (props.compacted) {
    const before = formatTokens(props.compactionTokensBefore)
    const after = formatTokens(props.compactionTokensAfter || props.tokenCount)
    parts.push(before && before !== '0'
      ? `Using compacted context: ${after} from ${before}`
      : 'Using compacted context')
    parts.push('Full chat stays visible.')
  } else if (clampedPercent.value >= 0.85) {
    parts.push('Checks each turn and summarizes older messages when needed.')
  }
  if (props.costLabel) parts.push(`Cost: ${props.costLabel}`)
  return parts.join('\n')
})

const tooltipLines = computed(() => tooltip.value.split('\n'))

function formatTokens(value) {
  if (!value) return '0'
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1) + 'm'
  if (value >= 1_000) return Math.round(value / 1_000) + 'k'
  return String(value)
}
</script>

<template>
  <span
    class="group relative inline-flex items-center justify-center flex-shrink-0"
    :aria-label="tooltip"
  >
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`" aria-hidden="true">
      <circle
        class="text-rule"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
      <circle
        v-if="clampedPercent > 0"
        class="-rotate-90 origin-center"
        :class="strokeClass"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        stroke="currentColor"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <span
      class="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-30 flex flex-col gap-px px-2 py-[5px] rounded-[5px] bg-ink text-surface font-mono text-[10px] leading-[1.35] whitespace-nowrap opacity-0 -translate-x-1/2 translate-y-0.5 transition-[opacity,transform] duration-[120ms] ease-out group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0"
    >
      <span v-for="line in tooltipLines" :key="line">{{ line }}</span>
    </span>
  </span>
</template>
