<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import EditorPanel from '../editor/EditorPanel.vue'
import ToastHost from '../ToastHost.vue'
import { useSettingsStore } from '../../stores/settings.js'
import { useSessionStore } from '../../stores/sessions.js'
import { useToastStore } from '../../stores/toasts.js'
import { applyThemeToDocument } from '../../services/themeSync.js'
import { isMacShortcutPlatform } from '../../services/shortcutLabels.js'
import type { TransferredTab } from '../editor/editorTabTransfer.js'

const settingsStore = useSettingsStore()
const sessionStore = useSessionStore()
const toastStore = useToastStore()
const port = ref(0)
const workspaceName = ref('')
const activeTabName = ref('')
const editorPanelRef = ref<InstanceType<typeof EditorPanel> | null>(null)
const isMac = isMacShortcutPlatform()

let adoptTabHandler: ((tab: unknown) => void) | null = null
let settingsChangedHandler: (() => void) | null = null
let bridgeEditorOpenHandler: ((data: unknown) => void) | null = null
const menuHandlers: Array<[string, (...args: unknown[]) => void]> = []

const headerTitle = computed(() => {
  const parts: string[] = []
  if (activeTabName.value) parts.push(activeTabName.value)
  if (workspaceName.value) parts.push(workspaceName.value)
  return parts.join(' — ')
})

const activeDirty = ref(false)
let lastActivePath = ''

function onActiveFileChanged(path: string) {
  const name = path ? path.split('/').pop() ?? '' : ''
  activeTabName.value = name
  lastActivePath = path
  document.title = name ? `${name} — Mim` : 'Mim'
  pushEditedState()
}

function onActiveDirtyChanged(dirty: boolean) {
  activeDirty.value = dirty
  pushEditedState()
}

function pushEditedState() {
  try {
    window.kernel.popoutSetEdited({
      title: document.title,
      dirty: activeDirty.value,
      path: lastActivePath,
    })
  } catch {
    // Best-effort; handler may not exist yet
  }
}

function onAllTabsClosed() {
  window.close()
}

async function onSendToTerminal(payload: { text: string; language: string | null }) {
  try {
    const result = await window.kernel.popoutForward({ type: 'terminal.send', payload })
    if (!result?.ok) {
      toastStore.push({ kind: 'error', message: 'Could not send to terminal' })
    }
  } catch {
    toastStore.push({ kind: 'error', message: 'Could not send to terminal' })
  }
}

async function onPrepareChatDraft(payload: { targetSessionId?: string | null; text: string; attachments: unknown[]; contextChips?: unknown[] }) {
  try {
    const result = await window.kernel.popoutForward({ type: 'chat.prepareDraft', payload })
    if (!result?.ok) {
      toastStore.push({ kind: 'error', message: 'Could not prepare chat draft' })
    }
  } catch {
    toastStore.push({ kind: 'error', message: 'Could not prepare chat draft' })
  }
}

function registerMenuHandlers() {
  const handlers: Array<[string, (...args: unknown[]) => void]> = [
    ['menu:save-file', () => { editorPanelRef.value?.saveActiveFile() }],
    ['menu:save-file-as', () => { editorPanelRef.value?.saveActiveFileAs() }],
    ['menu:close-tab', () => { editorPanelRef.value?.closeActiveTab() }],
    ['menu:new-document', () => { editorPanelRef.value?.createUntitledTab() }],
    ['menu:export-document', () => { editorPanelRef.value?.openExportDialog() }],
    ['menu:open-file', () => {
      void window.kernel.openFileDialog().then(path => {
        if (path) editorPanelRef.value?.openFile(path)
      })
    }],
    ['menu:open-recent', (path: unknown) => {
      if (typeof path === 'string') editorPanelRef.value?.openFile(path)
    }],
  ]
  for (const [channel, handler] of handlers) {
    window.kernel.on(channel, handler)
    menuHandlers.push([channel, handler])
  }
}

onMounted(async () => {
  // Register the adopt-tab listener FIRST, before signaling ready
  adoptTabHandler = (tab: unknown) => {
    editorPanelRef.value?.adoptTab(tab as TransferredTab)
  }
  window.kernel.on('editor:adopt-tab', adoptTabHandler)

  // Handle bridge:editor:open events routed to this pop-out
  bridgeEditorOpenHandler = (data: unknown) => {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const path = (data as Record<string, unknown>).path
      if (typeof path === 'string' && path.length > 0) {
        editorPanelRef.value?.openFile(path)
      }
    }
  }
  window.kernel.on('bridge:editor:open', bridgeEditorOpenHandler)

  // Listen for settings changes to re-sync theme
  settingsChangedHandler = () => {
    void settingsStore.load().then(() => {
      applyThemeToDocument(settingsStore.theme)
    })
  }
  window.kernel.on('settings:changed', settingsChangedHandler)

  // Register menu command handlers for focused-window routing
  registerMenuHandlers()

  // Critical path: settings (theme) + port must resolve before content shows.
  // Run them concurrently, then signal readiness to the main process.
  const [, portValue] = await Promise.all([settingsStore.load(), window.kernel.getPort()])
  applyThemeToDocument(settingsStore.theme)
  port.value = portValue

  // Signal readiness — main process can now deliver tabs
  await window.kernel.popoutReady()

  // Non-blocking: session list and workspace name are not required for readiness.
  // Fire-and-forget so they don't gate tab delivery.
  void (window.kernel.call('session.list') as Promise<{ sessions: unknown[] }>)
    .then((result) => {
      if (Array.isArray(result?.sessions)) {
        sessionStore.$patch({ sessions: result.sessions })
      }
    })
    .catch(() => {
      // Non-critical; the picker will just be empty
    })

  void window.kernel.getWorkspace()
    .then((ws: string) => {
      workspaceName.value = ws ? ws.split('/').pop() ?? '' : ''
    })
    .catch(() => {
      // Non-critical; header title will just omit the workspace name
    })
})

onBeforeUnmount(() => {
  if (adoptTabHandler) {
    window.kernel.off('editor:adopt-tab', adoptTabHandler)
    adoptTabHandler = null
  }
  if (settingsChangedHandler) {
    window.kernel.off('settings:changed', settingsChangedHandler)
    settingsChangedHandler = null
  }
  if (bridgeEditorOpenHandler) {
    window.kernel.off('bridge:editor:open', bridgeEditorOpenHandler)
    bridgeEditorOpenHandler = null
  }
  for (const [channel, handler] of menuHandlers) {
    window.kernel.off(channel, handler)
  }
  menuHandlers.length = 0
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-chrome-high">
    <div
      class="drag-region flex h-9 shrink-0 items-center border-b border-rule-light bg-chrome-high"
      :class="isMac ? 'pl-20' : 'pl-3'"
    >
      <span class="flex-1 truncate select-none font-sans text-[11px] text-ink-3">
        {{ headerTitle }}
      </span>
    </div>

    <EditorPanel
      ref="editorPanelRef"
      :port="port"
      window-role="popout"
      class="flex-1 min-h-0"
      @all-tabs-closed="onAllTabsClosed"
      @active-file-changed="onActiveFileChanged"
      @active-dirty-changed="onActiveDirtyChanged"
      @send-to-terminal="onSendToTerminal"
      @prepare-chat-draft="onPrepareChatDraft"
    />

    <ToastHost />
  </div>
</template>

<style scoped>
.drag-region {
  -webkit-app-region: drag;
}
</style>
