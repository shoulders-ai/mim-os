<script setup lang="ts">
import { computed } from 'vue'
import MimSelect from '../ui/MimSelect.vue'

interface ControlOption {
  id: string
  label?: string
}

const props = withDefaults(defineProps<{
  controlId?: string
  label?: string
  options?: ControlOption[]
  disabled?: boolean
}>(), {
  controlId: '',
  label: 'Control',
  options: () => [],
  disabled: false,
})

const emit = defineEmits<{
  'update:controlId': [id: string]
}>()

const currentLabel = computed(() => {
  const option = props.options.find(item => item.id === props.controlId)
  return option?.label || props.label || 'Default'
})

const selectOptions = computed(() =>
  props.options.map(option => ({
    value: option.id,
    label: option.label || option.id,
  })),
)

function selectControl(value: string | number) {
  emit('update:controlId', String(value))
}
</script>

<template>
  <MimSelect
    class="relative flex-none min-w-0"
    :model-value="controlId || ''"
    :options="selectOptions"
    :disabled="disabled || selectOptions.length === 0"
    placement="above"
    tone="ghost"
    size="sm"
    aria-label="Control"
    trigger-class="h-[26px] max-w-[116px] rounded-md border-transparent bg-transparent px-2 font-mono text-[11px] text-ink-2 overflow-hidden whitespace-nowrap disabled:pointer-events-none @max-[360px]:w-[26px] @max-[360px]:justify-center @max-[360px]:px-0"
    options-class="w-40"
    option-class="font-mono text-[12px] text-ink"
    chevron-class="text-ink-3"
    @update:model-value="selectControl"
  >
    <template #trigger>
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium @max-[360px]:hidden">{{ currentLabel }}</span>
    </template>
  </MimSelect>
</template>
