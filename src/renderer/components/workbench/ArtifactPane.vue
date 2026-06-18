<script setup lang="ts">
import PaneRail from './PaneRail.vue'
import type { PaneState } from '../../services/workbench/entries.js'

withDefaults(defineProps<{
  state?: PaneState
  expanded?: boolean
  title: string
  subtitle?: string
  meta?: string
}>(), {
  state: 'expanded',
  expanded: false,
  subtitle: '',
  meta: 'Editor',
})

defineEmits<{
  resize: [event: PointerEvent]
  restore: []
}>()
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 overflow-hidden"
    :class="[
      state === 'rail' ? 'w-11 shrink-0' : 'min-w-[336px] shrink-0',
      state === 'expanded' && expanded ? 'flex-1' : '',
    ]"
    data-pane="artifact"
    aria-label="Editor"
  >
    <!-- Edge-to-edge: the resize handle is always a persistent 1px hairline
         that spans the pane's full height (chrome-high header band above,
         surface content below). It is the Work/Artifact divider — no floating
         gap, no hover-only accent. The accent line lifts on hover to signal
         the resize affordance. -->
    <div
      v-if="state === 'expanded' && !expanded"
      class="group relative z-10 w-1.5 shrink-0 cursor-col-resize"
      data-testid="artifact-resize-handle"
      @pointerdown="$emit('resize', $event)"
    >
      <div class="h-10 bg-chrome-high" />
      <div class="absolute inset-x-0 bottom-0 top-10 bg-surface" />
      <div class="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-rule-light transition-colors duration-150 group-hover:bg-accent" />
    </div>

    <PaneRail
      v-if="state === 'rail'"
      pane="artifact"
      :title="title"
      :subtitle="subtitle"
      :meta="meta"
      @restore="$emit('restore')"
    />

    <div
      v-show="state === 'expanded'"
      class="flex min-h-0 min-w-0"
      :class="expanded ? 'flex-1' : 'shrink-0'"
    >
      <slot />
    </div>
  </section>
</template>
