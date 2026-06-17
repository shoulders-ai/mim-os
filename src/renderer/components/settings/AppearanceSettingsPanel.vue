<script setup lang="ts">
import { useSettingsStore, type ThemeName } from '../../stores/settings.js'
import SettingsGroup from './SettingsGroup.vue'

const settings = useSettingsStore()

// Swatch colors are data, not styling: each entry previews its theme's actual
// palette, so they stay inline :style (the sanctioned data-driven exception to
// Tailwind-only, like floating-ui positioning).
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
  </section>
</template>
