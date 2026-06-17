<script setup lang="ts">
// Workspace mark + teleported switcher popover. Self-contained: positioning
// and dismiss listeners live here and are only attached while the menu is
// open. Collapsing the Navigator unmounts this component, which closes the
// menu for free.
import { onUnmounted, nextTick, ref } from 'vue'

defineProps<{
  workspaceName: string | null
  recentWorkspaces: Array<{ path: string; name: string }>
  monogram: string
}>()

const emit = defineEmits<{
  openFolder: []
  openRecentWorkspace: [path: string]
  addProject: [mode: 'new' | 'clone']
}>()

const menuOpen = ref(false)
const buttonRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

function toggleMenu() {
  if (menuOpen.value) closeMenu()
  else openMenu()
}

function openMenu() {
  menuOpen.value = true
  document.addEventListener('pointerdown', onClickOutside)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', updateMenuPosition)
  window.addEventListener('scroll', updateMenuPosition, true)
  void nextTick(updateMenuPosition)
}

function closeMenu() {
  menuOpen.value = false
  document.removeEventListener('pointerdown', onClickOutside)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updateMenuPosition)
  window.removeEventListener('scroll', updateMenuPosition, true)
}

function updateMenuPosition() {
  const button = buttonRef.value
  if (!button) return
  const rect = button.getBoundingClientRect()
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 328))
  menuStyle.value = {
    top: `${rect.bottom + 4}px`,
    left: `${left}px`,
    minWidth: `${Math.max(220, rect.width)}px`,
  }
}

function onClickOutside(e: PointerEvent) {
  const target = e.target as Node
  if (buttonRef.value?.contains(target) || panelRef.value?.contains(target)) return
  closeMenu()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}

function doOpenFolder() {
  closeMenu()
  emit('openFolder')
}

function doOpenRecentWorkspace(path: string) {
  closeMenu()
  emit('openRecentWorkspace', path)
}

function doAddProject(mode: 'new' | 'clone') {
  closeMenu()
  emit('addProject', mode)
}

onUnmounted(closeMenu)
</script>

<template>
  <div class="relative">
    <!-- w-full: a button is shrink-to-fit by default and the `.relative` parent
         is not flex, so this spans the tray row instead of hugging the label.
         The monogram matches the collapsed workspace mark (h-7) so it does not
         resize on toggle; the chevron rides the right edge. -->
    <button
      ref="buttonRef"
      class="no-drag flex h-9 w-full min-w-0 items-center rounded-[6px] pr-2 text-left font-sans text-[12.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
      :aria-label="workspaceName ? `Switch workspace: ${workspaceName}` : 'Open workspace'"
      title="Switch workspace"
      @click.stop="toggleMenu"
    >
      <span class="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-rule-light bg-chrome-mid font-sans text-[11px] font-semibold leading-none tracking-tight text-ink-2">{{ monogram }}</span>
      <span class="ml-2 min-w-0 flex-1 truncate text-left">{{ workspaceName ?? 'Open workspace' }}</span>
      <svg class="ml-1 shrink-0 text-ink-4" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <Teleport to="body">
      <div
        v-if="menuOpen"
        ref="panelRef"
        class="fixed max-w-[320px] bg-surface border border-rule rounded-[6px] p-1 z-[200] shadow-lg"
        :style="menuStyle"
      >
        <template v-if="recentWorkspaces.length">
          <div class="px-[10px] pt-[5px] pb-[3px] font-sans text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-4">
            Recent
          </div>
          <button
            v-for="workspace in recentWorkspaces"
            :key="workspace.path"
            class="flex items-center gap-2 w-full min-w-0 px-[10px] py-[6px] rounded font-sans text-[12px] text-ink-2 text-left hover:bg-chrome-high hover:text-ink"
            :title="workspace.path"
            @click="doOpenRecentWorkspace(workspace.path)"
          >
            <svg class="text-ink-3 shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 109-9" />
              <path d="M3 3v6h6" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span class="flex flex-1 flex-col min-w-0">
              <span class="truncate">{{ workspace.name }}</span>
              <span class="truncate font-mono text-[10px] text-ink-4">{{ workspace.path }}</span>
            </span>
          </button>
          <div class="my-1 border-t border-rule-light" />
        </template>
        <button
          class="flex items-center gap-2 w-full px-[10px] py-[6px] rounded font-sans text-[12px] text-ink-2 text-left whitespace-nowrap hover:bg-chrome-high hover:text-ink"
          @click="doOpenFolder"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span>Open Folder...</span>
        </button>
        <button
          class="flex items-center gap-2 w-full px-[10px] py-[6px] rounded font-sans text-[12px] text-ink-2 text-left whitespace-nowrap hover:bg-chrome-high hover:text-ink"
          @click="doAddProject('new')"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 10v6M9 13h6" />
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
          <span>New Folder...</span>
        </button>
        <button
          class="flex items-center gap-2 w-full px-[10px] py-[6px] rounded font-sans text-[12px] text-ink-2 text-left whitespace-nowrap hover:bg-chrome-high hover:text-ink"
          @click="doAddProject('clone')"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 01-9 9" />
          </svg>
          <span>Clone Repository...</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
