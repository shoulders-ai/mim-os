<script setup>
import { computed } from 'vue'

const props = defineProps({
  percent: { type: Number, default: 0 },
  size: { type: Number, default: 16 },
  tokenCount: { type: Number, default: 0 },
  contextWindow: { type: Number, default: 0 },
  costLabel: { type: String, default: '' },
})

const emit = defineEmits(['start-fresh'])

const showStartFresh = computed(() => clampedPercent.value >= 0.85)

const radius = computed(() => Math.max(4, (props.size - 4) / 2))
const center = computed(() => props.size / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const clampedPercent = computed(() => Math.max(0, Math.min(1, props.percent)))
const dashOffset = computed(() => circumference.value * (1 - clampedPercent.value))

const strokeColor = computed(() => {
  if (clampedPercent.value > 0.85) return 'var(--color-rem)'
  if (clampedPercent.value > 0.6) return 'var(--color-accent)'
  return 'var(--color-ink-4)'
})

const tooltip = computed(() => {
  const pct = Math.round(clampedPercent.value * 100)
  const tokens = formatTokens(props.tokenCount)
  const context = formatTokens(props.contextWindow)
  const parts = [`Context: ${tokens} / ${context} (${pct}%)`]
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
    :style="{ width: size + 'px', height: size + 'px' }"
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
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        stroke-width="2"
        stroke-linecap="round"
        :stroke="strokeColor"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
      />
    </svg>
    <span
      class="absolute bottom-[calc(100%+7px)] left-1/2 z-30 flex flex-col gap-px px-2 py-[5px] rounded-[5px] bg-ink text-surface font-mono text-[10px] leading-[1.35] whitespace-nowrap opacity-0 -translate-x-1/2 translate-y-0.5 transition-[opacity,transform] duration-[120ms] ease-out group-hover:opacity-100 group-hover:translate-y-0"
      :class="showStartFresh ? 'pointer-events-auto' : 'pointer-events-none'"
      aria-hidden="true"
    >
      <span v-for="line in tooltipLines" :key="line">{{ line }}</span>
      <button
        v-if="showStartFresh"
        class="mt-1 rounded-[3px] bg-surface/20 px-1.5 py-0.5 text-[10px] font-medium text-surface hover:bg-surface/30"
        @click.stop="emit('start-fresh')"
      >Start fresh from summary</button>
    </span>
  </span>
</template>
