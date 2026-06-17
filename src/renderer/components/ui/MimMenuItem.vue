<script setup lang="ts">
import { computed } from 'vue'
import { MenuItem } from '@headlessui/vue'

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    danger?: boolean
    selected?: boolean
    headless?: boolean
    itemClass?: string
    buttonAttrs?: Record<string, unknown>
  }>(),
  {
    disabled: false,
    danger: false,
    selected: false,
    headless: true,
    itemClass: '',
    buttonAttrs: () => ({}),
  },
)

const emit = defineEmits<{ select: [] }>()

function onSelect() {
  if (props.disabled) return
  emit('select')
}

const itemClasses = computed(() => [
  'mim-menu-item flex min-h-7 w-full items-center gap-2 rounded-[5px] px-2.5 py-[6px] font-sans text-[12px] text-ink-2 text-left outline-none select-none',
  {
    'bg-accent-tint text-accent font-semibold': props.selected && !props.danger,
    'text-rem': props.danger && !props.selected,
    'bg-rem/10 text-rem font-semibold': props.danger && props.selected,
    'opacity-40': props.disabled,
  },
  props.itemClass,
])
</script>

<template>
  <MenuItem v-if="headless" v-slot="{ active }" :disabled="disabled" as="template">
    <button
      v-bind="buttonAttrs"
      type="button"
      :disabled="disabled"
      :class="[
        itemClasses,
        {
          'bg-chrome-high text-ink': active && !selected && !danger,
          'bg-rem/10 text-rem': active && danger,
        },
      ]"
      @click="onSelect"
    >
      <slot :active="active" :selected="selected" :disabled="disabled" :danger="danger" />
    </button>
  </MenuItem>
  <button
    v-else
    v-bind="buttonAttrs"
    type="button"
    role="menuitem"
    :disabled="disabled"
    :class="[
      itemClasses,
      {
        'hover:bg-chrome-high hover:text-ink': !selected && !danger,
        'hover:bg-rem/10 hover:text-rem': danger,
      },
    ]"
    @click="onSelect"
  >
    <slot :active="false" :selected="selected" :disabled="disabled" :danger="danger" />
  </button>
</template>
