<script setup lang="ts">
// One label/description + control row inside a SettingsGroup.
withDefaults(
  defineProps<{
    label: string
    desc?: string
  }>(),
  {
    desc: '',
  },
)
</script>

<template>
  <div class="flex min-h-[46px] items-center justify-between gap-4 border-b border-rule-light py-2.5 last:border-b-0">
    <div class="flex min-w-0 flex-col gap-0.5 font-sans">
      <span class="text-[12px] text-ink-2">{{ label }}</span>
      <span v-if="desc || $slots.desc" class="text-[10px] text-ink-3">
        <slot name="desc">{{ desc }}</slot>
      </span>
    </div>
    <slot />
  </div>
</template>
