<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { IconArrowUpRight } from '@tabler/icons-vue'
import { useSettingsStore } from '../../stores/settings.js'
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'
import MimToggle from '../ui/MimToggle.vue'

const settings = useSettingsStore()
const name = ref('')
const email = ref('')
const timezone = ref('')
const saving = ref(false)
const saved = ref(false)
const error = ref('')

onMounted(() => {
  name.value = settings.configUserName
  email.value = settings.configUserEmail
  timezone.value = settings.configTimezone
})

async function saveIdentity() {
  saving.value = true
  saved.value = false
  error.value = ''
  try {
    const result = await window.kernel.call('config.setUser', {
      name: name.value,
      email: email.value,
      timezone: timezone.value,
    }) as { user?: { name?: string; email?: string; timezone?: string } }
    settings.configUserName = result.user?.name ?? ''
    settings.configUserEmail = result.user?.email ?? ''
    settings.configTimezone = result.user?.timezone ?? ''
    saved.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function openPersonalInstructions() {
  error.value = ''
  try {
    const result = await window.kernel.call('instruction.open', { origin: 'personal' }) as { editorPath: string }
    await window.kernel.call('editor.open', { path: result.editorPath })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="General settings">
    <SettingsGroup title="You">
      <div class="grid gap-3 py-2 sm:grid-cols-2">
        <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Name
          <input v-model="name" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 text-[11px] normal-case tracking-normal text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
        </label>
        <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Email
          <input v-model="email" type="email" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 text-[11px] normal-case tracking-normal text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
        </label>
        <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Timezone
          <input v-model="timezone" placeholder="Europe/Berlin" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[10px] normal-case tracking-normal text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
        </label>
        <div class="flex items-end gap-2">
          <button type="button" class="h-8 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 disabled:opacity-50" :disabled="saving" @click="saveIdentity">
            {{ saving ? 'Saving' : 'Save' }}
          </button>
          <span v-if="saved" class="pb-2 text-[10px] text-add">Saved</span>
        </div>
      </div>
      <SettingRow label="Personal instructions" desc="Durable guidance that follows you across Projects.">
        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-rule-light px-2.5 text-[11px] text-ink-2 hover:bg-chrome-mid" @click="openPersonalInstructions">
          Open in Mim
          <IconArrowUpRight :size="13" />
        </button>
      </SettingRow>
    </SettingsGroup>

    <AppearanceSettingsPanel />

    <SettingsGroup title="Usage data">
      <SettingRow label="Anonymous usage data" :desc="settings.telemetryLocked ? 'Disabled by environment' : 'Anonymous counts only. No files, prompts, or paths.'">
        <MimToggle
          :model-value="settings.telemetryEnabled"
          :disabled="settings.telemetryLocked"
          aria-label="Share anonymous usage data"
          @update:model-value="settings.setTelemetryEnabled"
        />
      </SettingRow>
    </SettingsGroup>

    <p v-if="error" class="m-0 text-[11px] text-rem">{{ error }}</p>
  </section>
</template>
