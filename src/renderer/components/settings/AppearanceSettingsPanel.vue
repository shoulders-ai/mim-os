<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore, type ThemeName, type FontFamily } from '../../stores/settings.js'
import MimSelect, { type MimSelectOption } from '../ui/MimSelect.vue'
import MimToggle from '../ui/MimToggle.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

const settings = useSettingsStore()

// ── Theme ──

const themes: { id: ThemeName; label: string; accent: string; chrome: string; surface: string; ink: string }[] = [
  // Light
  { id: 'white',     label: 'Light',   accent: '#2d2d2d', chrome: '#fafafa', surface: '#ffffff', ink: '#1d1d1f' },
  { id: 'parchment', label: 'Humane',  accent: '#c05d3c', chrome: '#ebe9e3', surface: '#ffffff', ink: '#1a1a18' },
  { id: 'glacier',   label: 'North',   accent: '#4a7c9b', chrome: '#e4e8ec', surface: '#ffffff', ink: '#1c1f24' },
  { id: 'sage',      label: 'Sage',    accent: '#5a8266', chrome: '#e6e9e3', surface: '#fdfdfb', ink: '#1f231f' },
  // Dark
  { id: 'slate',     label: 'Dark',    accent: '#5a9e8f', chrome: '#1e1e1e', surface: '#2c2c2c', ink: '#e0e0dc' },
  { id: 'monokai',   label: 'Monokai', accent: '#f97316', chrome: '#1e1e1e', surface: '#272822', ink: '#f8f8f2' },
  { id: 'nord',      label: 'Nord',    accent: '#88c0d0', chrome: '#1e232c', surface: '#2e3440', ink: '#d8dee9' },
  { id: 'dracula',   label: 'Dracula', accent: '#bd93f9', chrome: '#12131a', surface: '#282a36', ink: '#f8f8f2' },
]

// ── Editor ──

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
  <section class="flex flex-col gap-6 text-ink" aria-label="Appearance settings">
    <SettingsGroup title="Theme">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 pb-2 pt-2">
        <button
          v-for="t in themes"
          :key="t.id"
          type="button"
          class="flex min-w-0 flex-col items-center gap-[7px] rounded-[8px] border-2 bg-transparent p-0"
          :class="settings.theme === t.id ? 'shadow-[0_0_0_1px_var(--color-surface)]' : 'border-rule-light hover:border-rule'"
          :style="settings.theme === t.id ? { borderColor: t.accent } : {}"
          :aria-pressed="settings.theme === t.id"
          @click="settings.set('theme', t.id)"
        >
          <span class="flex h-[54px] w-full flex-col overflow-hidden rounded-t-[6px]" :style="{ background: t.surface }">
            <span class="h-[5px] shrink-0" :style="{ background: t.chrome }" />
            <span class="flex min-h-0 flex-1">
              <span class="w-3 shrink-0" :style="{ background: t.chrome }" />
              <span class="flex min-w-0 flex-1 flex-col justify-center gap-[3px] px-[5px] py-1">
                <span class="h-[2px] rounded-[1px]" :style="{ background: t.ink + '40', width: '60%' }" />
                <span class="h-[2px] rounded-[1px]" :style="{ background: t.accent + '80', width: '45%' }" />
                <span class="h-[2px] rounded-[1px]" :style="{ background: t.ink + '30', width: '70%' }" />
                <span class="h-[2px] rounded-[1px]" :style="{ background: t.accent + '60', width: '35%' }" />
                <span class="h-[2px] rounded-[1px]" :style="{ background: t.ink + '28', width: '55%' }" />
              </span>
            </span>
          </span>
          <span
            class="font-sans text-[9.5px] font-medium text-ink-3"
            :style="settings.theme === t.id ? { color: t.accent } : {}"
          >{{ t.label }}</span>
          <span class="flex justify-center gap-[3px] pb-2">
            <span class="h-[5px] w-[5px] rounded-full" :style="{ background: t.accent }" />
            <span class="h-[5px] w-[5px] rounded-full" :style="{ background: t.chrome }" />
            <span class="h-[5px] w-[5px] rounded-full" :style="{ background: t.ink }" />
          </span>
        </button>
      </div>
    </SettingsGroup>

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

      <SettingRow label="Live preview" desc="Render markdown formatting inline, reveal syntax at cursor">
        <MimToggle
          :model-value="settings.editorLivePreview"
          aria-label="Live preview"
          @update:model-value="settings.set('editorLivePreview', $event)"
        />
      </SettingRow>
    </SettingsGroup>
  </section>
</template>
