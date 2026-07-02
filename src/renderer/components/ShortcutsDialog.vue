<script setup lang="ts">
import MimDialog from './ui/MimDialog.vue'
import { shortcutLabel } from '../services/shortcutLabels.js'

defineEmits<{ close: [] }>()

// Compiled from App.vue keydown handler, menu.ts accelerators, and
// EditorPanel.vue + codemirror/core.js keymaps. These are the real current
// shortcuts — no invented entries.
const sections = [
  {
    title: 'General',
    shortcuts: [
      { keys: shortcutLabel(['Mod', ',']), label: 'Settings' },
      { keys: shortcutLabel(['Mod', 'P']), label: 'Command palette' },
      { keys: shortcutLabel(['Mod', 'B']), label: 'Toggle Navigator' },
      { keys: shortcutLabel(['Mod', 'N']), label: 'New chat' },
      { keys: shortcutLabel(['Mod', 'T']), label: 'New terminal tab' },
      { keys: shortcutLabel(['Mod', 'W']), label: 'Close tab' },
      { keys: shortcutLabel(['Mod', 'O']), label: 'Open file' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: shortcutLabel(['Mod', '[']), label: 'Back in focused pane history' },
      { keys: shortcutLabel(['Mod', ']']), label: 'Forward in focused pane history' },
      { keys: shortcutLabel(['Ctrl', 'Tab']), label: 'Next chat session' },
      { keys: shortcutLabel(['Ctrl', 'Shift', 'Tab']), label: 'Previous chat session' },
      { keys: shortcutLabel(['Mod', 'Alt', '→']), label: 'Next activity' },
      { keys: shortcutLabel(['Mod', 'Alt', '←']), label: 'Previous activity' },
    ],
  },
  {
    title: 'Editor',
    shortcuts: [
      { keys: shortcutLabel(['Mod', 'S']), label: 'Save file' },
      { keys: shortcutLabel(['Shift', 'Mod', 'S']), label: 'Save as' },
      { keys: shortcutLabel(['Shift', 'Mod', 'E']), label: 'Export (PDF, Word)' },
      { keys: shortcutLabel(['Mod', 'F']), label: 'Find in file' },
      { keys: shortcutLabel(['Mod', 'K']), label: 'Inline AI rewrite' },
      { keys: shortcutLabel(['Mod', 'B']), label: 'Bold (Markdown)' },
      { keys: shortcutLabel(['Mod', 'I']), label: 'Italic (Markdown)' },
      { keys: shortcutLabel(['Shift', 'Mod', 'X']), label: 'Strikethrough (Markdown)' },
      { keys: shortcutLabel(['Shift', 'Mod', '8']), label: 'Bullet list (Markdown)' },
      { keys: shortcutLabel(['Shift', 'Mod', '7']), label: 'Numbered list (Markdown)' },
      { keys: shortcutLabel(['Shift', 'Mod', '.']), label: 'Blockquote (Markdown)' },
    ],
  },
]
</script>

<template>
  <MimDialog
    title="Keyboard Shortcuts"
    size="sm"
    @close="$emit('close')"
  >
    <div class="flex flex-col gap-4 px-5 py-4 font-sans text-xs text-ink-2">
      <div v-for="section in sections" :key="section.title">
        <h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{{ section.title }}</h3>
        <table class="w-full">
          <tbody>
            <tr
              v-for="s in section.shortcuts"
              :key="s.keys"
              class="border-b border-rule-light last:border-0"
            >
              <td class="py-1 pr-3 text-ink">{{ s.label }}</td>
              <td class="py-1 text-right font-mono text-[10px] text-ink-3">{{ s.keys }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex justify-end pt-1">
        <button
          class="rounded px-3 py-1 text-ink-3 hover:bg-chrome-mid hover:text-ink"
          @click="$emit('close')"
        >
          Close
        </button>
      </div>
    </div>
  </MimDialog>
</template>
