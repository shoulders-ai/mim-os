<script setup lang="ts">
import MimDialog from './ui/MimDialog.vue'
import {
  IconMessage,
  IconFolder,
  IconTerminal2,
  IconLayoutGrid,
} from '@tabler/icons-vue'

// First-run orientation. Mim exposes four core surfaces plus installable
// apps; this orients across them once, then gets out of the way. No app
// launcher cards (the chat empty state already stays focused) — just a quiet
// map of where things live, each row acting on click.
defineEmits<{
  close: []
  action: [key: 'chat' | 'file' | 'terminal' | 'apps']
}>()

const rows: { key: 'chat' | 'file' | 'terminal' | 'apps'; icon: typeof IconMessage; label: string; desc: string }[] = [
  { key: 'chat', icon: IconMessage, label: 'Start a chat', desc: 'Ask, build, and delegate to agents.' },
  { key: 'file', icon: IconFolder, label: 'Open a file', desc: 'Edit documents and code in the Artifact pane.' },
  { key: 'terminal', icon: IconTerminal2, label: 'Open a terminal', desc: 'Run shells and CLI coding agents.' },
  { key: 'apps', icon: IconLayoutGrid, label: 'Browse apps', desc: 'Install and manage workflow apps.' },
]
</script>

<template>
  <MimDialog size="sm" @close="$emit('close')">
    <div class="flex flex-col px-6 pb-5 pt-7 font-sans">
      <!-- Identity -->
      <div class="mb-2 h-px w-8 bg-accent" />
      <h2 class="mb-1.5 font-[family-name:var(--font-brand)] text-[22px] font-normal leading-tight tracking-tight text-ink">
        Welcome to Mim
      </h2>
      <p class="mb-5 text-[12px] leading-relaxed text-ink-3">
        A local-first workspace for AI-native work — chat, documents, terminal, and apps in one window.
      </p>

      <!-- Orientation rows: each maps a surface and dismisses -->
      <div class="mb-5 flex flex-col gap-px">
        <button
          v-for="row in rows"
          :key="row.key"
          type="button"
          class="group flex items-center gap-3 rounded-[6px] px-2 py-2 text-left hover:bg-chrome-mid"
          :data-testid="`welcome-${row.key}`"
          @click="$emit('action', row.key)"
        >
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-chrome-mid text-ink-3 group-hover:bg-surface group-hover:text-accent">
            <component :is="row.icon" :size="15" :stroke="1.8" />
          </span>
          <span class="flex min-w-0 flex-col">
            <span class="text-[12.5px] font-medium text-ink">{{ row.label }}</span>
            <span class="text-[11px] text-ink-3">{{ row.desc }}</span>
          </span>
        </button>
      </div>

      <!-- Dismiss -->
      <div class="flex justify-end">
        <button
          type="button"
          class="rounded-[5px] bg-accent px-3.5 py-1.5 text-[12px] font-medium text-accent-ink hover:opacity-85"
          data-testid="welcome-get-started"
          @click="$emit('close')"
        >
          Get started
        </button>
      </div>
    </div>
  </MimDialog>
</template>
