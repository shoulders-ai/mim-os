<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue: boolean
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    disabled: false,
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    class="mim-toggle relative h-5 w-9 shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
    :class="modelValue ? 'bg-accent' : 'bg-ink-4 hover:bg-ink-3'"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="ariaLabel"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-surface transition-transform duration-150 motion-reduce:transition-none"
      :class="modelValue ? 'translate-x-4' : ''"
    />
  </button>
</template>
