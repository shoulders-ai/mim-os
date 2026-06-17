<script setup lang="ts">
import { IconX, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-vue'
import { useToastStore } from '../stores/toasts.js'

const toasts = useToastStore()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="toasts.list.length > 0"
      class="fixed bottom-4 right-4 z-[var(--z-popover)] flex w-80 flex-col gap-2"
      data-testid="toast-host"
    >
      <div
        v-for="toast in toasts.list"
        :key="toast.id"
        class="flex items-start gap-2 rounded-[5px] border bg-surface px-3 py-2.5 shadow-sm"
        :class="toast.kind === 'error' ? 'border-rem/30' : 'border-rule-light'"
        role="alert"
        :data-testid="`toast-${toast.kind}`"
      >
        <IconAlertTriangle
          v-if="toast.kind === 'error'"
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0 text-rem"
        />
        <IconInfoCircle
          v-else
          :size="14"
          :stroke-width="2"
          class="mt-0.5 shrink-0 text-ink-3"
        />
        <div class="min-w-0 flex-1">
          <p class="font-sans text-[12px] font-medium text-ink">{{ toast.message }}</p>
          <p
            v-if="toast.detail"
            class="mt-0.5 truncate font-mono text-[10px] text-ink-3"
            :title="toast.detail"
          >{{ toast.detail }}</p>
        </div>
        <button
          v-if="toast.action && toast.actionLabel"
          type="button"
          class="shrink-0 rounded-[4px] px-1.5 py-0.5 font-sans text-[11px] font-medium text-accent hover:bg-accent-tint"
          @click="toast.action(); toasts.dismiss(toast.id)"
        >{{ toast.actionLabel }}</button>
        <button
          type="button"
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-mid hover:text-ink-2"
          title="Dismiss"
          @click="toasts.dismiss(toast.id)"
        >
          <IconX :size="12" :stroke-width="2.2" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
