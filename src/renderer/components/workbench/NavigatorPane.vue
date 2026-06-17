<script setup lang="ts">
// The Navigator never fully unmounts. ShellSidebar renders either the full
// tray or the collapsed icon rail itself, so this pane is just a flex slot
// holding it against the left window edge. Collapse/restore is owned by
// ShellSidebar (its `collapsed` prop), not by this wrapper.
</script>

<template>
  <section
    class="flex min-h-0 shrink-0"
    data-pane="navigator"
    aria-label="Navigator"
  >
    <slot />
  </section>
</template>
