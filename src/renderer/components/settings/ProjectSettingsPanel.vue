<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IconArrowUpRight } from '@tabler/icons-vue'
import StorageSettingsPanel from './StorageSettingsPanel.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

const path = ref('')
const error = ref('')
const name = computed(() => path.value.split(/[\\/]/).filter(Boolean).pop() || 'Project')

onMounted(async () => {
  path.value = await window.kernel.getWorkspace() ?? ''
})

async function openInstructions() {
  error.value = ''
  try {
    const result = await window.kernel.call('instruction.open', { origin: 'project' }) as { editorPath: string }
    await window.kernel.call('editor.open', { path: result.editorPath })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="Project settings">
    <SettingsGroup title="Current Project">
      <SettingRow label="Name" :desc="name" />
      <SettingRow label="Location" :desc="path || 'No Project open'" />
      <SettingRow label="Project instructions" desc="Guidance specific to this Project.">
        <button type="button" class="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-rule-light px-2.5 text-[11px] text-ink-2 hover:bg-chrome-mid" @click="openInstructions">
          Open in Mim
          <IconArrowUpRight :size="13" />
        </button>
      </SettingRow>
    </SettingsGroup>
    <StorageSettingsPanel />
    <p v-if="error" class="m-0 text-[11px] text-rem">{{ error }}</p>
  </section>
</template>
