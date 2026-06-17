<script setup lang="ts">
export interface MimSegmentedOption {
  value: string
  label: string
  title?: string
}

withDefaults(
  defineProps<{
    modelValue: string
    options: MimSegmentedOption[]
    ariaLabel?: string
    disabled?: boolean
  }>(),
  {
    ariaLabel: undefined,
    disabled: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div
    class="mim-segmented flex h-6 shrink-0 items-center rounded-full border border-rule bg-chrome-mid p-[2px]"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="h-5 rounded-full px-2.5 font-sans text-[11px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
      :class="modelValue === opt.value
        ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
        : 'text-ink-3 hover:text-ink-2'"
      role="radio"
      :aria-checked="modelValue === opt.value"
      :title="opt.title"
      :disabled="disabled"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
