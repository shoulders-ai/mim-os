<script setup lang="ts">
// A titled group of settings content. SettingRow children draw their own
// hairline dividers (border-b + last:border-b-0), so non-row children (cards,
// footnotes) can live in a group without fighting a divide-y.
withDefaults(
  defineProps<{
    title?: string
  }>(),
  {
    title: '',
  },
)
</script>

<template>
  <section class="settings-group">
    <h3 v-if="title" class="m-0 mb-1.5 text-[9px] font-semibold uppercase tracking-[1.8px] text-ink-3">
      {{ title }}
    </h3>
    <slot />
  </section>
</template>
