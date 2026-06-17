<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore, type AutomationApprovalMode } from '../../stores/settings.js'
import {
  modelDisplayName,
  providerDisplayName,
  providerConfigured,
  resolveFeatureDefault,
} from '../../services/ai/modelControls.js'
import { shortcutLabel } from '../../services/shortcutLabels.js'
import MimSelect, { type MimSelectOption } from '../ui/MimSelect.vue'
import MimSegmented from '../ui/MimSegmented.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

const settings = useSettingsStore()

// ── Keys ──
// Key status is shared, reactive state on the settings store so chat, inline
// rewrite, and this panel all reflect a key change immediately (no restart).
const inputs = ref<Record<string, string>>({})
const saving = ref<string | null>(null)
const saved = ref<string | null>(null)
// Providers whose configured key is being replaced; the input is hidden for
// configured providers until Replace is clicked.
const editing = ref<Set<string>>(new Set())

const providers = [
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'openai',    label: 'OpenAI',    placeholder: 'sk-...',     envVar: 'OPENAI_API_KEY' },
  { id: 'google',    label: 'Google',    placeholder: 'AIza...',    envVar: 'GOOGLE_API_KEY' },
]

function keyStatusFor(provider: string) {
  return settings.keyStatuses.find(s => s.provider === provider)
}

// Env-sourced keys are owned by the environment: writing ~/.mim/keys.env would
// have no effect (env wins in the resolver), so those rows are display-only.
function keyInputVisible(provider: string): boolean {
  const status = keyStatusFor(provider)
  if (!status?.configured) return true
  return status.source === 'file' && editing.value.has(provider)
}

function startReplace(provider: string) {
  editing.value.add(provider)
  editing.value = new Set(editing.value)
}

async function saveKey(provider: string) {
  const key = inputs.value[provider]?.trim()
  if (!key) return
  saving.value = provider
  try {
    await window.kernel.call('ai.setKey', { provider, key })
    inputs.value[provider] = ''
    editing.value.delete(provider)
    editing.value = new Set(editing.value)
    saved.value = provider
    setTimeout(() => { if (saved.value === provider) saved.value = null }, 2000)
    await settings.refreshKeyStatuses()
  } finally {
    saving.value = null
  }
}

async function clearKey(provider: string) {
  saving.value = provider
  try {
    await window.kernel.call('ai.clearKey', { provider })
    inputs.value[provider] = ''
    editing.value.delete(provider)
    editing.value = new Set(editing.value)
    await settings.refreshKeyStatuses()
  } finally {
    saving.value = null
  }
}

// ── Model defaults ──
interface ModelEntry {
  id: string
  displayName?: string
  name?: string
  provider: string
  providerLabel?: string
  disabled?: boolean
}

type ModelFeature = 'chat' | 'inline' | 'ghost'
type ModelSettingKey = 'lastChatModel' | 'lastInlineModel' | 'lastGhostModel'

interface ModelRegistry {
  defaults?: Record<string, string[]>
  models: ModelEntry[]
}

interface ModelSelectOption extends MimSelectOption {
  providerText: string
  isDefault: boolean
}

const modelRegistry = ref<ModelRegistry | null>(null)

const modelPreferences: Array<{
  id: ModelFeature
  label: string
  desc: string
  settingKey: ModelSettingKey
}> = [
  { id: 'chat', label: 'Chat', desc: 'Default model for new conversations', settingKey: 'lastChatModel' },
  { id: 'inline', label: 'Inline rewrite', desc: `Model for ${shortcutLabel(['Mod', 'K'])} edits inside the editor`, settingKey: 'lastInlineModel' },
  { id: 'ghost', label: 'Ghost suggestions', desc: 'Model for editor continuations after ++', settingKey: 'lastGhostModel' },
]

async function loadModels() {
  try {
    modelRegistry.value = await window.kernel.call('ai.registry') as ModelRegistry
  } catch { /* no registry */ }
}

function selectModel(settingKey: ModelSettingKey, value: string | number) {
  settings.set(settingKey, String(value))
}

function featureModels(feature: ModelFeature): ModelEntry[] {
  const registry = modelRegistry.value
  if (!registry) return []
  const models = registry.models || []
  const order = registry.defaults?.[feature] || []
  const preferred = order.length
    ? order.map(id => models.find(model => model.id === id)).filter(Boolean) as ModelEntry[]
    : models
  return preferred.map(model => ({
    ...model,
    disabled: !providerConfigured(settings.keyStatuses, model.provider),
  }))
}

function featureDefaultId(feature: ModelFeature): string {
  return resolveFeatureDefault(modelRegistry.value, feature)?.id || ''
}

function featureModelOptions(feature: ModelFeature, effectiveId?: string): ModelSelectOption[] {
  const defaultId = featureDefaultId(feature)
  const toOption = (model: ModelEntry): ModelSelectOption => {
    const providerText = providerDisplayName(model)
    return {
      value: model.id,
      label: modelDisplayName(model),
      disabled: model.disabled,
      title: model.disabled ? `${providerText} key is not configured` : undefined,
      testId: `settings-model-option-${feature}-${model.id}`,
      providerText,
      isDefault: model.id === defaultId,
    }
  }
  const options = featureModels(feature).map(toOption)
  // The effective model (workspace override or ~/.mim/config.yaml) may not be
  // in the feature's preferred list — e.g. a config.yaml model outside the
  // registry's defaults order. Append it so the trigger never renders blank.
  if (effectiveId && !options.some(option => option.value === effectiveId)) {
    const known = (modelRegistry.value?.models || []).find(model => model.id === effectiveId)
    options.push(known
      ? toOption({ ...known, disabled: !providerConfigured(settings.keyStatuses, known.provider) })
      : {
          value: effectiveId,
          label: effectiveId,
          testId: `settings-model-option-${feature}-${effectiveId}`,
          providerText: '',
          isDefault: false,
        })
  }
  return options
}

// The config.yaml layer (~/.mim/config.yaml). Only chat and ghost have a config layer.
function configDefaultFor(feature: ModelFeature): string {
  if (feature === 'chat') return settings.configChatModel || ''
  if (feature === 'ghost') return settings.configGhostModel || ''
  return ''
}

function selectedModelValue(settingKey: ModelSettingKey): string {
  return (settings as unknown as Record<ModelSettingKey, string>)[settingKey] || ''
}

// Cascade: workspace override → ~/.mim/config.yaml → registry default.
function effectiveModelId(settingKey: ModelSettingKey, feature: ModelFeature): string {
  return selectedModelValue(settingKey) || configDefaultFor(feature) || featureDefaultId(feature)
}

// True when the effective value comes from the config.yaml layer (not override, not registry).
function isFromConfig(settingKey: ModelSettingKey, feature: ModelFeature): boolean {
  return !selectedModelValue(settingKey) && !!configDefaultFor(feature)
}

function modelOptionProvider(option: MimSelectOption | null): string {
  return (option as ModelSelectOption | null)?.providerText || ''
}

function modelOptionIsDefault(option: MimSelectOption | null): boolean {
  return (option as ModelSelectOption | null)?.isDefault ?? false
}

// ── Automation safety ──
const approvalModes: { id: AutomationApprovalMode; label: string; desc: string }[] = [
  { id: 'strict', label: 'Strict', desc: 'Ask before every action' },
  { id: 'normal', label: 'Normal', desc: 'Ask before changes and outside requests' },
  { id: 'developer', label: 'Allow all', desc: 'No approval prompts' },
]

const approvalDesc = computed(() =>
  approvalModes.find(mode => mode.id === settings.automationApprovalMode)?.desc ?? '',
)

onMounted(async () => {
  await Promise.all([settings.refreshKeyStatuses(), loadModels()])
})
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="AI settings">
    <!-- Keys -->
    <SettingsGroup title="Keys">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div
          v-for="prov in providers"
          :key="prov.id"
          class="border-b border-rule-light px-3 py-2.5 last:border-b-0"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="h-[7px] w-[7px] shrink-0 rounded-full"
                :class="keyStatusFor(prov.id)?.configured ? 'bg-add' : 'bg-ink-4'"
              />
              <span class="text-[12px] font-medium text-ink">{{ prov.label }}</span>
              <code class="rounded-[3px] bg-chrome-mid px-1.5 py-px font-mono text-[9px] text-ink-3">{{ prov.envVar }}</code>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span v-if="saved === prov.id" class="text-[10px] text-add">Key saved</span>
              <template v-if="keyStatusFor(prov.id)?.configured">
                <!-- env keys are owned by the shell: removing/replacing from
                     here would be a lie (the env var wins on next launch). -->
                <span
                  v-if="keyStatusFor(prov.id)?.source === 'env'"
                  class="text-[10px] text-ink-3"
                  :title="`Set by ${prov.envVar} in your environment — change or remove it there`"
                >From environment</span>
                <template v-else>
                  <button
                    v-if="!editing.has(prov.id)"
                    type="button"
                    class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
                    :disabled="saving === prov.id"
                    @click="startReplace(prov.id)"
                  >Replace</button>
                  <button
                    type="button"
                    class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:border-rem/40 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
                    :disabled="saving === prov.id"
                    @click="clearKey(prov.id)"
                  >Remove</button>
                </template>
              </template>
              <span v-else class="text-[10px] italic text-ink-3">Not configured</span>
            </div>
          </div>
          <div v-if="keyInputVisible(prov.id)" class="mt-2 flex items-center gap-2">
            <input
              v-model="inputs[prov.id]"
              type="password"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              :placeholder="prov.placeholder"
              :aria-label="`${prov.label} API key`"
              @keydown.enter="saveKey(prov.id)"
            />
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-40"
              :disabled="!inputs[prov.id]?.trim() || saving === prov.id"
              @click="saveKey(prov.id)"
            >{{ saving === prov.id ? '…' : 'Save' }}</button>
          </div>
        </div>
      </div>
      <p class="m-0 pt-2 text-center text-[10px] text-ink-3">Keys are stored in ~/.mim/keys.env</p>
    </SettingsGroup>

    <!-- Model defaults -->
    <SettingsGroup title="Model defaults">
      <SettingRow
        v-for="pref in modelPreferences"
        :key="pref.id"
        :label="pref.label"
        :desc="pref.desc"
      >
        <div class="flex shrink-0 flex-col items-end">
          <span
            v-if="isFromConfig(pref.settingKey, pref.id)"
            class="mb-0.5 block text-right font-mono text-[9px] uppercase tracking-wide text-ink-3"
          >from ~/.mim/config.yaml</span>
          <MimSelect
            :model-value="effectiveModelId(pref.settingKey, pref.id)"
            :options="featureModelOptions(pref.id, effectiveModelId(pref.settingKey, pref.id))"
            aria-label="Model default"
            trigger-class="w-[178px] justify-between"
            options-class="min-w-[240px] max-w-[320px]"
            option-class="justify-between gap-3"
            :trigger-attrs="{ 'data-testid': `settings-model-trigger-${pref.id}` }"
            :options-attrs="{ 'data-testid': `settings-model-menu-${pref.id}` }"
            @update:model-value="selectModel(pref.settingKey, $event)"
          >
            <template #option="{ option }">
              <span class="min-w-0 truncate text-left">{{ option.label }}</span>
              <span class="flex shrink-0 items-center gap-2">
                <span
                  v-if="modelOptionIsDefault(option)"
                  class="rounded border border-rule-light px-1 font-mono text-[9px] uppercase tracking-wide text-accent"
                >Default</span>
                <span class="shrink-0 font-mono text-[9px] text-ink-3">{{ modelOptionProvider(option) }}</span>
              </span>
            </template>
          </MimSelect>
        </div>
      </SettingRow>
    </SettingsGroup>

    <!-- Automation safety -->
    <SettingsGroup title="Automation safety">
      <SettingRow label="Approval mode" :desc="approvalDesc">
        <MimSegmented
          :model-value="settings.automationApprovalMode"
          :options="approvalModes.map(mode => ({ value: mode.id, label: mode.label, title: mode.desc }))"
          aria-label="Automation approval mode"
          @update:model-value="settings.set('automationApprovalMode', $event)"
        />
      </SettingRow>
    </SettingsGroup>
  </section>
</template>
