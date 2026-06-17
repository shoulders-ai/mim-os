<script setup lang="ts">
import PaneRail from './PaneRail.vue'
import type { PaneState } from '../../services/workbench/entries.js'

withDefaults(defineProps<{
  state?: PaneState
  title: string
  subtitle?: string
  meta?: string
  leftConnected?: boolean
  // The Artifact header owns restore controls (both Navigator and Work are
  // collapsed): quiet the Work rail so its top restore icon does not sit as a
  // confusing second expand control next to the header's restore cluster.
  quiet?: boolean
}>(), {
  state: 'expanded',
  subtitle: '',
  meta: 'Work',
  leftConnected: false,
  quiet: false,
})

defineEmits<{
  restore: []
}>()
</script>

<template>
  <main
    class="flex min-h-0 min-w-0 overflow-hidden"
    :class="state === 'rail' ? 'w-11 shrink-0' : 'min-w-[336px] flex-1'"
    data-pane="work"
  >
    <PaneRail
      v-if="state === 'rail'"
      pane="work"
      :title="title"
      :subtitle="subtitle"
      :meta="meta"
      :quiet="quiet"
      @restore="$emit('restore')"
    />

    <!-- Edge-to-edge: no card rounding. The header is a chrome-high band
         (border-b hairline); the content is surface. Left-connected (Navigator
         collapsed) keeps the bridge melt — the rail + header form one
         continuous chrome-high L, the content carries only the left hairline
         that outlines it against the rail. The header keeps its border-b in
         both states so the surface starts at the same y (no 1px shift on
         toggle). Standalone (Navigator expanded) is plain flush. -->
    <div
      v-show="state === 'expanded'"
      class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      :class="leftConnected ? 'bg-chrome-high' : ''"
    >
      <slot name="header" />
      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
        :class="leftConnected ? 'border-l border-rule-light' : ''"
      >
        <slot />
      </div>
    </div>
  </main>
</template>
