<script setup lang="ts">
// Multi-tab scratch terminal. Tab management (strip, rename, drag-reorder,
// context menus, pty spawn/kill ownership) lives here; the per-xterm-instance
// lifecycle lives in TerminalSurface, one per tab.
import { ref, reactive, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import TerminalSurface from './TerminalSurface.vue'
import MimContextMenu from '../ui/MimContextMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import { shortcutLabel } from '../../services/shortcutLabels.js'

const props = withDefaults(defineProps<{
  active?: boolean
}>(), {
  active: true,
})

/* ── Types ── */
interface TermTab {
  id: number
  label: string
  ptyId: number | null
  exited: boolean
}

type SurfaceHandle = InstanceType<typeof TerminalSurface>

/* ── State ── */
let nextTabId = 1
const tabs = ref<TermTab[]>([])
const activeTabId = ref<number | null>(null)
const panelEl = ref<HTMLElement | null>(null)
let initialTabPromise: Promise<void> | null = null
// Surface instances are looked up imperatively (focus/fit/clear/copy), so a
// plain Map keyed by tab id is enough — no reactivity needed.
const surfaces = new Map<number, SurfaceHandle>()

function setSurfaceRef(tabId: number, el: unknown) {
  if (el) surfaces.set(tabId, el as SurfaceHandle)
  else surfaces.delete(tabId)
}

function surfaceFor(tabId: number | null): SurfaceHandle | null {
  return tabId !== null ? surfaces.get(tabId) ?? null : null
}

/* ── Context menu ── */
const ctxMenu = reactive({ open: false, x: 0, y: 0, tabId: -1 })

function openCtxMenu(tabId: number, e: MouseEvent) {
  ctxMenu.open = true
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.tabId = tabId
}

function closeCtxMenu() {
  ctxMenu.open = false
}

function ctxRename() {
  const id = ctxMenu.tabId
  closeCtxMenu()
  nextTick(() => startRename(id))
}

function ctxClose() {
  const id = ctxMenu.tabId
  closeCtxMenu()
  closeTab(id)
}

/* ── Terminal context menu (right-click on terminal surface) ── */
const termCtx = reactive({ open: false, x: 0, y: 0 })

function openTermCtx(e: MouseEvent) {
  e.preventDefault()
  termCtx.open = true
  termCtx.x = e.clientX
  termCtx.y = e.clientY
}

function closeTermCtx() {
  termCtx.open = false
}

function termCtxCopy() {
  const sel = surfaceFor(activeTabId.value)?.getSelection()
  if (sel) navigator.clipboard.writeText(sel)
  closeTermCtx()
}

async function termCtxPaste() {
  closeTermCtx()
  const tab = tabs.value.find(t => t.id === activeTabId.value)
  if (!tab || tab.ptyId === null) return
  const text = await navigator.clipboard.readText()
  if (text) window.kernel.ptyWrite(tab.ptyId, text)
}

function termCtxClear() {
  surfaceFor(activeTabId.value)?.clear()
  closeTermCtx()
}

function termCtxSelectAll() {
  surfaceFor(activeTabId.value)?.selectAll()
  closeTermCtx()
}

/* ── Rename ── */
const renameTabId = ref<number | null>(null)
const renameValue = ref('')

function startRename(tabId: number) {
  renameTabId.value = tabId
  const tab = tabs.value.find(t => t.id === tabId)
  renameValue.value = tab?.label ?? ''
  nextTick(() => {
    const input = document.querySelector('.tp-rename') as HTMLInputElement
    if (input) { input.focus(); input.select() }
  })
}

function commitRename() {
  if (renameTabId.value === null) return
  const trimmed = renameValue.value.trim()
  if (trimmed) {
    const tab = tabs.value.find(t => t.id === renameTabId.value)
    if (tab) tab.label = trimmed
  }
  renameTabId.value = null
}

function cancelRename() {
  renameTabId.value = null
}

function onTabDblClick(tabId: number) {
  startRename(tabId)
}

/* ── Drag reorder ── */
const dragIndex = ref(-1)
let dragStartX = 0
let dragActive = false

function onTabPointerDown(i: number, e: PointerEvent) {
  if (renameTabId.value !== null) return
  dragIndex.value = i
  dragStartX = e.clientX
  dragActive = false
  document.addEventListener('pointermove', onTabDragMove)
  document.addEventListener('pointerup', onTabDragEnd)
}

function onTabDragMove(e: PointerEvent) {
  const dx = e.clientX - dragStartX
  if (!dragActive && Math.abs(dx) < 5) return
  dragActive = true

  const tabEls = Array.from(document.querySelectorAll('.tp-tab'))
  for (let i = 0; i < tabEls.length; i++) {
    if (i === dragIndex.value) continue
    const rect = tabEls[i].getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    if (dragIndex.value < i && e.clientX > mid) {
      const moved = tabs.value.splice(dragIndex.value, 1)[0]
      tabs.value.splice(i, 0, moved)
      dragIndex.value = i
      dragStartX = e.clientX
      break
    } else if (dragIndex.value > i && e.clientX < mid) {
      const moved = tabs.value.splice(dragIndex.value, 1)[0]
      tabs.value.splice(i, 0, moved)
      dragIndex.value = i
      dragStartX = e.clientX
      break
    }
  }
}

function onTabDragEnd() {
  dragIndex.value = -1
  dragActive = false
  document.removeEventListener('pointermove', onTabDragMove)
  document.removeEventListener('pointerup', onTabDragEnd)
}

function onTabClick(tabId: number) {
  if (dragActive) return
  selectTab(tabId)
}

/* ── PTY spawn ── */
async function spawnPty(tabId: number) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab) return
  if (tab.ptyId !== null) return
  const surface = surfaces.get(tab.id)

  try {
    const dims = surface?.dimensions() ?? { cols: 80, rows: 24 }
    const result = await window.kernel.call('terminal.spawn', {
      cols: dims.cols,
      rows: dims.rows,
    }) as { id: number }

    const liveTab = tabs.value.find(t => t.id === tab.id)
    if (!liveTab) return
    liveTab.ptyId = result.id
    liveTab.exited = false
  } catch (err) {
    surface?.write(`\x1b[31mFailed to spawn terminal: ${err}\x1b[0m\r\n`)
  }
}

/* ── Surface events ── */
function onSurfaceExited(tab: TermTab) {
  tab.ptyId = null
  tab.exited = true
  surfaces.get(tab.id)?.write('\r\n\x1b[90m[Process exited — press Enter to restart]\x1b[0m\r\n')
}

function onSurfaceInput(tab: TermTab, data: string) {
  if (tab.exited && data === '\r') {
    tab.exited = false
    surfaces.get(tab.id)?.clear()
    spawnPty(tab.id)
  }
}

/* ── Tab management ── */
async function addTab() {
  const id = nextTabId++
  const tab: TermTab = { id, label: `Tab ${id}`, ptyId: null, exited: false }
  tabs.value.push(tab)
  activeTabId.value = id

  await nextTick()

  const surface = surfaces.get(id)
  surface?.fit()
  await spawnPty(id)
  await nextTick()
  surfaceFor(id)?.fit()
  surfaceFor(id)?.focus()
}

function closeTab(tabId: number) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx < 0) return

  const tab = tabs.value[idx]

  // Kill PTY — the surface cleans up its own listeners when it unmounts.
  if (tab.ptyId !== null) {
    window.kernel.call('terminal.kill', { id: tab.ptyId }).catch(() => {})
  }

  tabs.value.splice(idx, 1)

  // If last tab closed, spawn a new one (can't have zero tabs)
  if (tabs.value.length === 0) {
    addTab()
    return
  }

  // Adjust active tab
  if (activeTabId.value === tabId) {
    activeTabId.value = tabs.value[Math.min(idx, tabs.value.length - 1)]?.id ?? null
  }

  nextTick(() => focusActive())
}

function closeActiveTab() {
  if (activeTabId.value !== null) closeTab(activeTabId.value)
}

function selectTab(tabId: number) {
  activeTabId.value = tabId
  nextTick(() => {
    const surface = surfaces.get(tabId)
    surface?.fit()
    surface?.focus()
  })
}

function focusActive() {
  const surface = surfaceFor(activeTabId.value)
  surface?.fit()
  surface?.focus()
}

async function activate() {
  await nextTick()
  focusActive()
}

function ensureTerminalTab(): Promise<void> {
  if (initialTabPromise) return initialTabPromise
  if (tabs.value.length > 0) return Promise.resolve()
  initialTabPromise = addTab().finally(() => {
    initialTabPromise = null
  })
  return initialTabPromise
}

async function runCommand(command: string) {
  await ensureTerminalTab()
  await nextTick()

  let tab = tabs.value.find(item => item.id === activeTabId.value)
  if (!tab) return

  if (tab.ptyId === null && !tab.exited) {
    await spawnPty(tab.id)
    await nextTick()
    tab = tabs.value.find(item => item.id === activeTabId.value)
  }

  if (tab?.ptyId != null) {
    await window.kernel.call('terminal.write', { id: tab.ptyId, data: command + '\n' })
  }
}

/* ── Clear active terminal (Cmd+K) ── */
function clearActiveTerminal() {
  surfaceFor(activeTabId.value)?.clear()
}

/* ── Keyboard shortcuts (scoped to terminal panel) ── */
function isTerminalFocused(): boolean {
  return !!panelEl.value && panelEl.value.contains(document.activeElement)
}

function onKeydown(e: KeyboardEvent) {
  if (!isTerminalFocused()) return  // only handle when focus is inside the terminal
  const meta = e.metaKey || e.ctrlKey

  // Cmd+W — close active terminal tab
  if (meta && e.key === 'w') {
    e.preventDefault()
    e.stopPropagation()
    closeActiveTab()
  }

  // Cmd+K — clear active terminal when terminal is active.
  if (meta && e.key === 'k') {
    e.preventDefault()
    e.stopPropagation()
    clearActiveTerminal()
  }

  // Option+Cmd+Left — previous terminal tab
  if (meta && e.altKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    e.stopPropagation()
    const idx = tabs.value.findIndex(t => t.id === activeTabId.value)
    if (idx > 0) selectTab(tabs.value[idx - 1].id)
  }

  // Option+Cmd+Right — next terminal tab
  if (meta && e.altKey && e.key === 'ArrowRight') {
    e.preventDefault()
    e.stopPropagation()
    const idx = tabs.value.findIndex(t => t.id === activeTabId.value)
    if (idx >= 0 && idx < tabs.value.length - 1) selectTab(tabs.value[idx + 1].id)
  }
}

/* ── Lifecycle ── */
onMounted(async () => {
  document.addEventListener('keydown', onKeydown, true)
  await ensureTerminalTab()
})

watch(() => props.active, (active) => {
  if (active) void activate()
}, { flush: 'post' })

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
  for (const tab of tabs.value) {
    if (tab.ptyId !== null) {
      window.kernel.call('terminal.kill', { id: tab.ptyId }).catch(() => {})
    }
  }
})

defineExpose({ addTab, closeActiveTab, clearActiveTerminal, activate, runCommand, tabs, activeTabId })
</script>

<template>
  <div ref="panelEl" class="terminal-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface" @contextmenu.prevent="openTermCtx">
    <!-- Tab strip -->
    <div class="flex items-center gap-px px-2 h-7 bg-chrome-high border-b border-rule-light shrink-0">
      <button
        v-for="(tab, i) in tabs"
        :key="tab.id"
        class="tp-tab group flex items-center gap-1 h-[22px] px-2 rounded font-mono text-[10px] text-ink-3 min-w-0 max-w-[140px] hover:bg-chrome-mid hover:text-ink-2"
        :class="{
          'bg-accent-tint text-ink font-medium': activeTabId === tab.id,
          'opacity-50': dragIndex === i,
        }"
        @click="onTabClick(tab.id)"
        @dblclick="onTabDblClick(tab.id)"
        @contextmenu.prevent.stop="openCtxMenu(tab.id, $event)"
        @pointerdown.left="onTabPointerDown(i, $event)"
      >
        <input
          v-if="renameTabId === tab.id"
          v-model="renameValue"
          class="tp-rename font-mono text-[10px] text-ink bg-transparent border-0 border-b border-accent outline-none p-0 w-[72px] min-w-0"
          autocorrect="off"
          autocapitalize="off"
          @keydown.enter="commitRename"
          @keydown.escape="cancelRename"
          @blur="commitRename"
          @click.stop
          @contextmenu.stop
          @pointerdown.stop
          @dblclick.stop
        />
        <template v-else>
          <span class="truncate flex-1 min-w-0">{{ tab.label }}</span>
          <span
            class="text-[13px] leading-none text-ink-4 opacity-0 group-hover:opacity-100 hover:text-rem ml-0.5 shrink-0"
            @click.stop="closeTab(tab.id)"
          >&times;</span>
        </template>
      </button>

      <button
        class="w-5 h-5 flex items-center justify-center rounded text-ink-4 ml-0.5 hover:bg-chrome-mid hover:text-ink-2"
        @click="addTab"
        :title="`New terminal (${shortcutLabel(['Mod', 'T'])})`"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <!-- Terminal surfaces (all in DOM, visibility toggled) -->
    <div class="relative min-h-0 flex-1 overflow-hidden bg-surface">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        v-show="activeTabId === tab.id"
        :data-tab-id="tab.id"
        class="absolute inset-y-1 left-2 right-2 overflow-hidden"
      >
        <TerminalSurface
          :ref="el => setSurfaceRef(tab.id, el)"
          :active="props.active && activeTabId === tab.id"
          :pty-id="tab.ptyId"
          @exited="onSurfaceExited(tab)"
          @input="data => onSurfaceInput(tab, data)"
        />
      </div>
    </div>

    <!-- Tab context menu -->
    <MimContextMenu
      v-if="ctxMenu.open"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :width="130"
      :height="70"
      panel-class="tp-ctx"
      @close="closeCtxMenu"
    >
      <MimMenuItem :headless="false" item-class="h-[26px] px-[10px] py-0 text-[11.5px]" @select="ctxRename">
        Rename
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-[26px] px-[10px] py-0 text-[11.5px]" @select="ctxClose">
        Close
      </MimMenuItem>
    </MimContextMenu>

    <!-- Terminal surface context menu (right-click) -->
    <MimContextMenu
      v-if="termCtx.open"
      :x="termCtx.x"
      :y="termCtx.y"
      :width="130"
      :height="132"
      panel-class="tp-term-ctx tp-ctx"
      @close="closeTermCtx"
    >
      <MimMenuItem :headless="false" item-class="h-[26px] px-[10px] py-0 text-[11.5px]" @select="termCtxCopy">
        Copy
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-[26px] px-[10px] py-0 text-[11.5px]" @select="termCtxPaste">
        Paste
      </MimMenuItem>
      <div class="h-px mx-1.5 my-[3px] bg-rule-light" />
      <MimMenuItem :headless="false" item-class="h-[26px] px-[10px] py-0 text-[11.5px]" @select="termCtxClear">
        Clear
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-[26px] px-[10px] py-0 text-[11.5px]" @select="termCtxSelectAll">
        Select All
      </MimMenuItem>
    </MimContextMenu>
  </div>
</template>

<style>
/* Kept alongside TerminalSurface's own .terminal-surface rules: the chrome
   contract test pins these selectors, and the declarations are identical. */
.terminal-panel [data-tab-id] .xterm {
  height: 100%;
  max-width: 100%;
  overflow: hidden;
}

.terminal-panel [data-tab-id] .xterm-viewport {
  overflow-x: hidden !important;
  scrollbar-width: none;
  background: transparent !important;
}

.terminal-panel [data-tab-id] .xterm-viewport::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.terminal-panel [data-tab-id] .xterm-screen {
  max-width: 100%;
}
</style>
