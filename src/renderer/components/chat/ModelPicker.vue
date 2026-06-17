<script setup lang="ts">
import { computed } from 'vue'
import ProviderIcon from '../ui/ProviderIcon.vue'
import MimSelect from '../ui/MimSelect.vue'

interface ModelEntry {
  id: string
  provider?: string
  displayName?: string
  name?: string
  shortLabel?: string
  contextWindow?: number
  disabled?: boolean
}

interface SelectOption {
  value: string | number
  label: string
  disabled?: boolean
  title?: string
  testId?: string
}

interface ModelSelectOption extends SelectOption {
  model: ModelEntry
}

const props = withDefaults(defineProps<{
  modelId?: string
  models?: ModelEntry[]
  disabled?: boolean
  placement?: 'below' | 'above' | 'auto'
}>(), {
  modelId: '',
  models: () => [],
  disabled: false,
  placement: 'above',
})

const emit = defineEmits<{
  'update:modelId': [id: string]
}>()

const providerOrder = ['anthropic', 'google', 'openai']

const currentModel = computed(() =>
  props.models.find(m => m.id === props.modelId) || null
)

// Prefer shortLabel: the provider icon already conveys the brand, so the
// label drops the redundant brand word (e.g. "Haiku 4.5", "3.5 Flash").
const currentLabel = computed(() =>
  currentModel.value?.shortLabel || currentModel.value?.displayName || currentModel.value?.name || props.modelId || 'Model'
)

const currentProvider = computed(() => currentModel.value?.provider || '')
const currentInitial = computed(() => currentLabel.value.trim().slice(0, 1).toUpperCase() || 'M')

const orderedModels = computed(() => {
  const ordered: ModelEntry[] = []
  const seen = new Set<string>()
  for (const provider of providerOrder) {
    const items = props.models.filter(m => m.provider === provider)
    if (items.length) {
      ordered.push(...items)
      items.forEach(m => seen.add(m.id))
    }
  }
  ordered.push(...props.models.filter(m => !seen.has(m.id)))
  return ordered
})

const modelOptions = computed<ModelSelectOption[]>(() =>
  orderedModels.value.map(model => ({
    value: model.id,
    label: modelLabel(model),
    disabled: model.disabled,
    testId: `model-picker-option-${model.id}`,
    model,
  })),
)

const selectedValue = computed(() => currentModel.value?.id || props.modelId || modelOptions.value[0]?.value || '')

function modelLabel(model?: ModelEntry | null) {
  return model?.shortLabel || model?.displayName || model?.name || model?.id || ''
}

function optionModel(option: SelectOption | null): ModelEntry | null {
  return (option as ModelSelectOption | null)?.model ?? null
}

function optionLabel(option: SelectOption | null) {
  return modelLabel(optionModel(option)) || currentLabel.value
}

function optionProvider(option: SelectOption | null) {
  return optionModel(option)?.provider || currentProvider.value
}

function optionInitial(option: SelectOption | null) {
  return optionLabel(option).trim().slice(0, 1).toUpperCase() || currentInitial.value
}

function optionContextWindow(option: SelectOption | null) {
  return optionModel(option)?.contextWindow
}

function optionValue(option: SelectOption | null) {
  return String(option?.value ?? '')
}

function selectModel(value: string | number) {
  emit('update:modelId', String(value))
}
</script>

<template>
  <MimSelect
    class="relative flex-[0_1_auto] min-w-[44px] max-w-[154px] @max-[470px]:max-w-[120px] @max-[360px]:flex-[0_0_30px] @max-[360px]:min-w-[30px] @max-[360px]:max-w-[30px]"
    :model-value="selectedValue"
    :options="modelOptions"
    :disabled="disabled || modelOptions.length === 0"
    :placement="placement"
    tone="ghost"
    size="sm"
    aria-label="Model"
    trigger-class="mp-trigger h-[26px] w-auto rounded-md border-transparent bg-transparent px-2 font-mono text-[11px] text-ink-2 whitespace-nowrap overflow-hidden disabled:pointer-events-none @max-[360px]:w-full @max-[360px]:justify-center @max-[360px]:p-0 @max-[360px]:gap-0"
    options-class="mp-dropdown w-[260px]"
    option-class="mp-option font-mono text-xs text-ink"
    chevron-class="text-ink-3 @max-[360px]:hidden"
    :trigger-attrs="{ 'data-testid': 'model-picker-trigger' }"
    :options-attrs="{ 'data-testid': 'model-picker-menu' }"
    @update:model-value="selectModel"
  >
    <template #trigger="{ option }">
      <ProviderIcon
        v-if="optionProvider(option)"
        class="mp-provider-icon w-3 h-3 shrink-0 text-ink-3"
        :provider="optionProvider(option)"
        :size="12"
      />
      <span
        v-else
        class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-[4px] shrink-0 bg-chrome-high text-ink-3 font-mono text-[9px] font-bold"
      >{{ optionInitial(option) }}</span>
      <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-medium @max-[360px]:hidden">{{ optionLabel(option) }}</span>
    </template>

    <template #option="{ option }">
      <ProviderIcon class="mp-provider-icon w-3 h-3 shrink-0 text-ink-3" :provider="optionProvider(option)" :size="12" />
      <span :data-testid="`model-picker-option-label-${optionValue(option)}`" class="mp-option-name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ optionLabel(option) }}</span>
      <span
        v-if="optionContextWindow(option)"
        :data-testid="`model-picker-option-context-${optionValue(option)}`"
        class="text-[10px] text-ink-3 font-mono shrink-0"
      >{{ Math.round((optionContextWindow(option) || 0) / 1000) }}k</span>
    </template>
  </MimSelect>
</template>
