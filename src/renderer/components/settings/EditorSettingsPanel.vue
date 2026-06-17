<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore, type FontFamily } from '../../stores/settings.js'
import MimSelect, { type MimSelectOption } from '../ui/MimSelect.vue'
import MimToggle from '../ui/MimToggle.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

const settings = useSettingsStore()

const fonts: { key: FontFamily; label: string; family: string }[] = [
  { key: 'serif', label: 'Serif (Lora)', family: 'Lora, Georgia, serif' },
  { key: 'sans',  label: 'Sans (Satoshi)', family: 'Satoshi, sans-serif' },
  { key: 'mono',  label: 'Mono (JetBrains)', family: 'JetBrains Mono, monospace' },
  { key: 'slab',  label: 'Slab (Zilla)', family: 'Zilla Slab, Georgia, serif' },
]

interface FontSelectOption extends MimSelectOption {
  family: string
}

const fontOptions = computed<FontSelectOption[]>(() =>
  fonts.map(font => ({
    value: font.key,
    label: font.label,
    family: font.family,
  })),
)

function selectFont(value: string | number) {
  settings.set('editorFontFamily', String(value) as FontFamily)
}

function fontOptionFamily(option: MimSelectOption | null): string {
  return (option as FontSelectOption | null)?.family || ''
}
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="Editor settings">
    <SettingsGroup title="Text">
      <SettingRow label="Text size" desc="Font size for the editor">
        <div class="flex shrink-0 items-center overflow-hidden rounded-[5px] border border-rule-light bg-chrome-mid">
          <button
            type="button"
            class="flex h-6 w-[26px] items-center justify-center text-[14px] leading-none text-ink-3 hover:bg-chrome hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Decrease text size"
            :disabled="settings.editorFontSize <= 12"
            @click="settings.set('editorFontSize', settings.editorFontSize - 1)"
          >&#8722;</button>
          <span class="min-w-[42px] border-x border-rule-light text-center font-mono text-[10px] leading-6 text-ink-2">{{ settings.editorFontSize }}px</span>
          <button
            type="button"
            class="flex h-6 w-[26px] items-center justify-center text-[14px] leading-none text-ink-3 hover:bg-chrome hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Increase text size"
            :disabled="settings.editorFontSize >= 24"
            @click="settings.set('editorFontSize', settings.editorFontSize + 1)"
          >+</button>
        </div>
      </SettingRow>

      <SettingRow label="Font" desc="Typeface for the editor">
        <MimSelect
          :model-value="settings.editorFontFamily"
          :options="fontOptions"
          aria-label="Editor font"
          options-class="min-w-[160px]"
          @update:model-value="selectFont"
        >
          <template #option="{ option }">
            <span :style="{ fontFamily: fontOptionFamily(option) }">{{ option.label }}</span>
          </template>
        </MimSelect>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup title="Behavior">
      <SettingRow label="Word wrap" desc="Wrap long lines to fit the viewport">
        <MimToggle
          :model-value="settings.editorWordWrap"
          aria-label="Word wrap"
          @update:model-value="settings.set('editorWordWrap', $event)"
        />
      </SettingRow>

      <SettingRow label="Line numbers" desc="Show line numbers in the gutter">
        <MimToggle
          :model-value="settings.editorLineNumbers"
          aria-label="Line numbers"
          @update:model-value="settings.set('editorLineNumbers', $event)"
        />
      </SettingRow>

      <SettingRow label="Spell check" desc="Underline misspelled words">
        <MimToggle
          :model-value="settings.editorSpellCheck"
          aria-label="Spell check"
          @update:model-value="settings.set('editorSpellCheck', $event)"
        />
      </SettingRow>
    </SettingsGroup>
  </section>
</template>
