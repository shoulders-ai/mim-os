<script setup lang="ts">
import {
  IconArrowBarToLeft,
  IconArrowBarToRight,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconLayoutSidebarLeftExpand,
} from '@tabler/icons-vue'
import { shortcutLabel } from '../../services/shortcutLabels.js'

withDefaults(defineProps<{
  pane: 'navigator' | 'work' | 'artifact'
  title: string
  subtitle?: string
  canBack?: boolean
  canForward?: boolean
  canCollapse?: boolean
  canExpand?: boolean
  expanded?: boolean
  renameable?: boolean
  renaming?: boolean
  renameValue?: string
  showNavigatorRestore?: boolean
  // >0 = header is bridged into the collapsed Navigator rail: pad the leading
  // controls past the macOS traffic lights (NAVIGATOR_HEADER_BRIDGE_INSET).
  bridgeInset?: number
  // The Work pane is railed and this header is the first expanded pane: show a
  // restore-Work control alongside the sidebar restore so both left panes have
  // one clear restore cluster in the header (instead of a confusing pair of
  // expand icons split between the rail and the header).
  showWorkRestore?: boolean
}>(), {
  subtitle: '',
  canBack: false,
  canForward: false,
  canCollapse: true,
  canExpand: false,
  expanded: false,
  renameable: false,
  renaming: false,
  renameValue: '',
  showNavigatorRestore: false,
  bridgeInset: 0,
  showWorkRestore: false,
})

defineEmits<{
  back: []
  forward: []
  collapse: []
  expand: []
  startRename: []
  'update:renameValue': [value: string]
  commitRename: []
  cancelRename: []
  restoreNavigator: []
  restoreWork: []
}>()

const iconButtonClass = 'no-drag flex h-6 w-6 items-center justify-center rounded-[5px] text-ink-3 hover:enabled:bg-chrome-mid hover:enabled:text-ink disabled:cursor-default disabled:opacity-35'
</script>

<template>
  <header
    class="drag-region grid h-10 min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-rule-light bg-chrome-high pl-2 pr-2 border-b"
    :style="bridgeInset > 0 ? { paddingLeft: `calc(0.5rem + ${bridgeInset}px)` } : undefined"
    :data-pane="pane"
    :data-bridged="showNavigatorRestore ? 'true' : 'false'"
  >
    <div class="no-drag flex min-w-0 items-center gap-1" aria-label="Pane restore and history">
      <button
        v-if="showNavigatorRestore"
        type="button"
        :class="iconButtonClass"
        :title="`Expand sidebar (${shortcutLabel(['Mod', 'B'])})`"
        aria-label="Expand sidebar"
        data-testid="navigator-restore"
        @click="$emit('restoreNavigator')"
      >
        <IconLayoutSidebarLeftExpand :size="13" :stroke-width="1.9" />
      </button>
      <button
        v-if="showWorkRestore"
        type="button"
        :class="iconButtonClass"
        title="Restore Work pane"
        aria-label="Restore Work pane"
        data-testid="work-restore"
        @click="$emit('restoreWork')"
      >
        <IconArrowBarToRight :size="13" :stroke-width="1.9" />
      </button>
      <span
        v-if="showNavigatorRestore || showWorkRestore"
        class="mx-0.5 h-4 w-px shrink-0 bg-rule-light"
        aria-hidden="true"
      />
      <button
        type="button"
        :class="iconButtonClass"
        :disabled="!canBack"
        :title="`Back in ${pane === 'artifact' ? 'Artifact' : 'Work'} history (${shortcutLabel(['Mod', '['])})`"
        @click="$emit('back')"
      >
        <IconChevronLeft :size="13" :stroke-width="2.2" />
      </button>
      <button
        type="button"
        :class="iconButtonClass"
        :disabled="!canForward"
        :title="`Forward in ${pane === 'artifact' ? 'Artifact' : 'Work'} history (${shortcutLabel(['Mod', ']'])})`"
        @click="$emit('forward')"
      >
        <IconChevronRight :size="13" :stroke-width="2.2" />
      </button>
    </div>

    <div class="flex min-w-0 items-center gap-[7px]">
      <input
        v-if="renaming"
        class="no-drag m-0 min-w-0 max-w-[280px] border-0 border-b border-accent bg-transparent p-0 font-sans text-[12px] font-[650] tracking-normal text-ink outline-none"
        :value="renameValue"
        autofocus
        autocorrect="off"
        autocapitalize="off"
        @input="$emit('update:renameValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('commitRename')"
        @keydown.escape="$emit('cancelRename')"
        @blur="$emit('commitRename')"
      />
      <h2
        v-else
        class="m-0 min-w-0 truncate font-sans text-[12px] font-[650] tracking-normal text-ink-2"
        :title="renameable ? 'Double-click to rename' : title"
        @dblclick="renameable && $emit('startRename')"
      >
        {{ title }}
      </h2>
      <slot name="title-suffix" />
      <span v-if="subtitle" class="truncate font-mono text-[10px] text-ink-4">{{ subtitle }}</span>
    </div>

    <div class="no-drag flex min-w-0 items-center gap-1">
      <slot name="actions" />

      <button
        v-if="canExpand"
        type="button"
        :class="[iconButtonClass, expanded ? 'bg-chrome-mid text-ink' : '']"
        :title="expanded ? 'Restore split' : `Expand ${pane === 'work' ? 'Work' : 'Editor'}`"
        @click="$emit('expand')"
      >
        <IconArrowsMaximize v-if="!expanded" :size="13" :stroke-width="1.9" />
        <IconArrowsMinimize v-else :size="13" :stroke-width="1.9" />
      </button>

      <button
        v-if="canCollapse"
        type="button"
        :class="iconButtonClass"
        :title="`Collapse ${pane === 'work' ? 'Work' : 'Editor'}`"
        @click="$emit('collapse')"
      >
        <IconArrowBarToLeft v-if="pane === 'work'" :size="13" :stroke-width="1.9" />
        <IconArrowBarToRight v-else :size="13" :stroke-width="1.9" />
      </button>
    </div>
  </header>
</template>
