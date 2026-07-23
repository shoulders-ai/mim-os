<script setup lang="ts">
import { ref, watch } from 'vue'
import { IconX } from '@tabler/icons-vue'
import MimDialog from '../ui/MimDialog.vue'
import AiSettingsPanel from './AiSettingsPanel.vue'
import AppsSettingsPanel from './AppsSettingsPanel.vue'
import ConnectionsSettingsPanel from './ConnectionsSettingsPanel.vue'
import ToolsSettingsPanel from './ToolsSettingsPanel.vue'
import SkillsSettingsPanel from './SkillsSettingsPanel.vue'
import GeneralSettingsPanel from './GeneralSettingsPanel.vue'
import TeamSettingsPanel from './TeamSettingsPanel.vue'
import ProjectSettingsPanel from './ProjectSettingsPanel.vue'
import SettingsUpdateFooter from './SettingsUpdateFooter.vue'
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
        <template v-for="group in SETTINGS_NAV_GROUPS" :key="group.label">
          <div class="mb-1 mt-2 px-2.5 font-sans text-[9px] font-semibold uppercase tracking-[1.6px] text-ink-4 first:mt-0">
            {{ group.label }}
          </div>
          <button
            v-for="item in group.items"
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
          :class="activeSection === 'apps' ? 'overflow-hidden' : 'overflow-y-auto px-8 py-6'"
        >
          <GeneralSettingsPanel v-if="activeSection === 'general'" />
          <AiSettingsPanel v-else-if="activeSection === 'ai'" />
          <ConnectionsSettingsPanel v-else-if="activeSection === 'connections'" />
          <TeamSettingsPanel v-else-if="activeSection === 'team'" />
          <ProjectSettingsPanel v-else-if="activeSection === 'project'" />
          <ToolsSettingsPanel v-else-if="activeSection === 'tools'" />
          <AppsSettingsPanel
            v-else-if="activeSection === 'apps'"
            @open-package="emit('openPackage', $event)"
            @open-package-docs="emit('openPackageDocs', $event)"
          />
          <SkillsSettingsPanel v-else-if="activeSection === 'skills'" />
        </div>
        <SettingsUpdateFooter />
      </div>
    </div>
  </MimDialog>
</template>
