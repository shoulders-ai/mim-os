<script setup lang="ts">
import { ref, watch } from 'vue'
import { IconX } from '@tabler/icons-vue'
import MimDialog from '../ui/MimDialog.vue'
import AiSettingsPanel from './AiSettingsPanel.vue'
import AppsSettingsPanel from './AppsSettingsPanel.vue'
import AppearanceSettingsPanel from './AppearanceSettingsPanel.vue'
import ConnectionsSettingsPanel from './ConnectionsSettingsPanel.vue'
import ToolsSettingsPanel from './ToolsSettingsPanel.vue'
import SkillsSettingsPanel from './SkillsSettingsPanel.vue'
import InstructionsSettingsPanel from './InstructionsSettingsPanel.vue'
import WorkspaceSettingsPanel from './WorkspaceSettingsPanel.vue'
import AboutSettingsPanel from './AboutSettingsPanel.vue'
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_NAV_ITEMS,
  DEFAULT_SETTINGS_SECTION,
  settingsSectionLabel,
  type SettingsSection,
} from './sections.js'

const props = withDefaults(defineProps<{
  initialSection?: SettingsSection
}>(), {
  initialSection: DEFAULT_SETTINGS_SECTION,
})

const emit = defineEmits<{
  close: []
  openPackage: [id: string]
  openPackageDocs: [id: string]
}>()

// The dialog is shell-only: nav, header, and section routing. Every section
// body lives in its own panel component beside this file. Escape/backdrop
// close comes from MimDialog (headlessui) — no manual key handling here.
const activeSection = ref<SettingsSection>(props.initialSection)
const navEl = ref<HTMLElement | null>(null)

watch(() => props.initialSection, (section) => {
  activeSection.value = section
})

function selectSection(id: SettingsSection) {
  activeSection.value = id
}

// Arrow keys move through the flat nav list (group dividers are skipped
// implicitly); focus follows selection so the keyboard stays oriented.
function onNavKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const index = SETTINGS_NAV_ITEMS.findIndex(item => item.id === activeSection.value)
  const delta = e.key === 'ArrowDown' ? 1 : -1
  const next = SETTINGS_NAV_ITEMS[(index + delta + SETTINGS_NAV_ITEMS.length) % SETTINGS_NAV_ITEMS.length]
  activeSection.value = next.id
  navEl.value?.querySelector<HTMLButtonElement>(`[data-section="${next.id}"]`)?.focus()
}
</script>

<template>
  <MimDialog
    aria-label="Settings"
    size="xl"
    height="fixed"
    @close="$emit('close')"
  >
    <div
      data-testid="settings-dialog-layout"
      class="flex min-h-0 flex-1 flex-row"
    >
      <!-- Sidebar nav. sd-nav / sd-main stay as structural hooks (tests). -->
      <nav
        ref="navEl"
        class="sd-nav flex w-[140px] shrink-0 flex-col gap-0.5 border-r border-rule-light bg-chrome px-2 py-3"
        aria-label="Settings sections"
        @keydown="onNavKeydown"
      >
        <div class="mb-1.5 px-2.5 pt-1 font-sans text-[9px] font-semibold uppercase tracking-[1.8px] text-ink-3">
          Settings
        </div>
        <template v-for="(group, groupIndex) in SETTINGS_NAV_GROUPS" :key="groupIndex">
          <div v-if="groupIndex > 0" class="mx-2.5 my-1.5 border-t border-rule-light" role="presentation" />
          <button
            v-for="item in group"
            :key="item.id"
            type="button"
            class="flex items-center rounded-[6px] px-2.5 py-2 text-left font-sans text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            :class="activeSection === item.id
              ? 'bg-accent-soft font-semibold text-accent'
              : 'font-medium text-ink-2 hover:bg-chrome-mid'"
            :data-section="item.id"
            :aria-current="activeSection === item.id ? 'true' : undefined"
            @click="selectSection(item.id)"
          >
            {{ item.label }}
          </button>
        </template>
      </nav>

      <!-- Content -->
      <div class="sd-main flex min-w-0 flex-1 flex-col">
        <div class="flex h-11 shrink-0 items-center justify-between border-b border-rule-light px-5">
          <span class="font-sans text-[12px] font-semibold tracking-[0.2px] text-ink">
            {{ settingsSectionLabel(activeSection) }}
          </span>
          <button
            type="button"
            class="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
            aria-label="Close settings"
            @click="$emit('close')"
          >
            <IconX :size="14" :stroke-width="2" />
          </button>
        </div>

        <div
          class="flex-1"
          :class="activeSection === 'apps' ? 'overflow-hidden' : activeSection === 'instructions' ? 'flex flex-col px-8 py-6' : 'overflow-y-auto px-8 py-6'"
        >
          <AppearanceSettingsPanel v-if="activeSection === 'appearance'" />
          <AiSettingsPanel v-else-if="activeSection === 'ai'" />
          <InstructionsSettingsPanel v-else-if="activeSection === 'instructions'" />
          <ConnectionsSettingsPanel v-else-if="activeSection === 'connections'" />
          <ToolsSettingsPanel v-else-if="activeSection === 'tools'" />
          <AppsSettingsPanel
            v-else-if="activeSection === 'apps'"
            @open-package="emit('openPackage', $event)"
            @open-package-docs="emit('openPackageDocs', $event)"
          />
          <SkillsSettingsPanel v-else-if="activeSection === 'skills'" />
          <WorkspaceSettingsPanel v-else-if="activeSection === 'workspace'" />
          <AboutSettingsPanel v-else-if="activeSection === 'about'" />
        </div>
      </div>
    </div>
  </MimDialog>
</template>
