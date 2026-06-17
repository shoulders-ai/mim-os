<script setup lang="ts">
withDefaults(defineProps<{
  dragging?: boolean
}>(), {
  dragging: false,
})
</script>

<template>
  <div
    class="workbench-shell flex h-full bg-chrome"
    :class="dragging ? 'is-dragging [&_*]:pointer-events-none' : ''"
    data-pane-shell="workbench"
  >
    <slot name="navigator" />

    <!-- Edge-to-edge instrument: Navigator, Work, and Artifact run flush to
         all four window edges. There is no floating-card moat — depth comes
         from the chrome → chrome-high → surface gradient and 1px hairline
         dividers between panes, not from cards floating on a canvas. The
         collapsed Navigator still melts into the first pane header (its rail
         is a flush chrome-high slab); the bridge lives in WorkPane +
         ShellSidebar, not here. -->
    <div
      class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-pane-shell="body"
    >
      <slot name="work" />
      <slot name="artifact" />
    </div>

    <slot name="overlays" />
  </div>
</template>
