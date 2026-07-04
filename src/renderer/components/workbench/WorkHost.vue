<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ChatView from '../chat/ChatView.vue'
import TerminalPanel from '../terminal/TerminalPanel.vue'
import FilesWorkView from '../files/FilesWorkView.vue'
import ActivityTrustView from '../activity/ActivityTrustView.vue'
import PackageFrame from '../packages/PackageFrame.vue'
import PackageRunView from '../packages/PackageRunView.vue'
import AgentSessionView from '../agents/AgentSessionView.vue'
import ArchiveBrowser from '../archive/ArchiveBrowser.vue'
import type { WorkEntry } from '../../services/workbench/entries.js'
import type { WorkHostKind } from '../../services/workbench/hosts.js'
import type { ApprovalRequest } from '../../stores/approvals.js'
import type { PackageViewDefinition } from '../../services/workbench/packageViews.js'
import type { WorkspaceMoveResult } from '../files/fileMove.js'

interface LoadedPackage {
  manifest: {
    id: string
    name: string
    icon?: string
    description?: string
    views?: PackageViewDefinition[]
  }
  dir: string
  source: string
}

const props = defineProps<{
  activeHost: WorkHostKind
  activeWork: WorkEntry | null
  packages: LoadedPackage[]
  port: number
  recentFiles: Array<{ path: string; name: string }>
  activeFilePath?: string
  filesRefreshKey?: number
  archiveRefreshKey?: number
}>()

const emit = defineEmits<{
  openFile: [path: string]
  openFileNative: [path: string]
  openFileHistory: [path: string]
  newFile: []
  openFileDialog: []
  pathMoved: [move: WorkspaceMoveResult]
  openPackage: [id: string]
  openSession: [id: string]
  archiveSession: [id: string]
  openPackageRun: [packageId: string, runId: string]
  reviewApproval: [approval: ApprovalRequest]
  openSettings: []
  openAgentSession: [agentId: string, sessionId: string]
}>()

const terminalRef = ref<InstanceType<typeof TerminalPanel> | null>(null)
const chatRef = ref<{
  sendExternalMessage?: (message: string) => Promise<void> | void
  prepareDraft?: (payload: { text?: string; attachments?: unknown[]; contextChips?: unknown[] }) => void
} | null>(null)
const terminalMounted = ref(false)
const filesMounted = ref(false)
const activityTrustMounted = ref(false)
const archiveMounted = ref(false)

const activePackage = computed(() => {
  const work = props.activeWork
  if (work?.kind !== 'package-view') return null
  return props.packages.find(pkg => pkg.manifest.id === work.packageId) ?? null
})

watch(
  () => [props.activeHost, props.activeWork?.id] as const,
  async () => {
    if (props.activeHost === 'terminal') terminalMounted.value = true
    if (props.activeHost === 'files') filesMounted.value = true
    if (props.activeHost === 'activity-trust') activityTrustMounted.value = true
    if (props.activeHost === 'archive') archiveMounted.value = true
    if (props.activeHost === 'terminal') {
      await nextTick()
      terminalRef.value?.activate?.()
    }
  },
  { immediate: true },
)

async function sendExternalMessage(message: string) {
  await nextTick()
  await chatRef.value?.sendExternalMessage?.(message)
}

async function prepareChatDraft(payload: { text?: string; attachments?: unknown[]; contextChips?: unknown[] }) {
  await nextTick()
  chatRef.value?.prepareDraft?.(payload)
}

async function runTerminalCommand(command: string) {
  if (!terminalMounted.value) {
    terminalMounted.value = true
  }
  await nextTick()
  const terminal = terminalRef.value as any
  if (!terminal) return

  if (typeof terminal.runCommand === 'function') {
    await terminal.runCommand(command)
    return
  }

  if (!terminal.tabs?.length) {
    await terminal.addTab?.()
    await nextTick()
  }

  const tab = terminal.tabs?.find((item: any) => item.id === terminal.activeTabId)
  if (tab?.ptyId != null) {
    await window.kernel.call('terminal.write', { id: tab.ptyId, data: command + '\n' })
  }
}

async function sendTerminalText(text: string, opts?: { spawn?: { program: string } }) {
  if (!terminalMounted.value) {
    terminalMounted.value = true
  }
  await nextTick()
  const terminal = terminalRef.value as any
  if (!terminal) return

  if (typeof terminal.sendText === 'function') {
    await terminal.sendText(text, opts)
  }
}

async function addTerminalTab() {
  await nextTick()
  await terminalRef.value?.addTab?.()
}

function closeTerminalTab() {
  terminalRef.value?.closeActiveTab?.()
}

defineExpose({
  sendExternalMessage,
  prepareChatDraft,
  runTerminalCommand,
  sendTerminalText,
  addTerminalTab,
  closeTerminalTab,
})
</script>

<template>
  <ChatView
    v-show="activeHost === 'chat'"
    key="chat"
    ref="chatRef"
    :session-id="activeWork?.kind === 'chat' ? activeWork.sessionId : undefined"
    :draft="activeWork?.kind === 'chat-draft'"
    @open-file="emit('openFile', $event)"
    @session-created="emit('openSession', $event)"
    @archive-session="emit('archiveSession', $event)"
    @review-approval="emit('reviewApproval', $event)"
    @open-settings="emit('openSettings')"
  />
  <TerminalPanel
    v-if="terminalMounted"
    v-show="activeHost === 'terminal'"
    key="terminal"
    ref="terminalRef"
    :active="activeHost === 'terminal'"
  />
  <FilesWorkView
    v-if="filesMounted"
    v-show="activeHost === 'files'"
    :active="activeHost === 'files'"
    :refresh-key="filesRefreshKey"
    :recent-files="recentFiles"
    :active-file-path="activeFilePath"
    @open-file="emit('openFile', $event)"
    @open-file-native="emit('openFileNative', $event)"
    @open-file-history="emit('openFileHistory', $event)"
    @new-file="emit('newFile')"
    @open-file-dialog="emit('openFileDialog')"
    @path-moved="emit('pathMoved', $event)"
  />
  <ActivityTrustView
    v-if="activityTrustMounted"
    v-show="activeHost === 'activity-trust'"
    :active="activeHost === 'activity-trust'"
  />
  <ArchiveBrowser
    v-if="archiveMounted"
    v-show="activeHost === 'archive'"
    :active="activeHost === 'archive'"
    :refresh-key="archiveRefreshKey"
    @open-session="emit('openSession', $event)"
    @open-package-run="(packageId, runId) => emit('openPackageRun', packageId, runId)"
    @open-agent-session="(agentId, sessionId) => emit('openAgentSession', agentId, sessionId)"
  />
  <KeepAlive>
    <PackageFrame
      v-if="activeWork?.kind === 'package-view'"
      :key="activeWork.id"
      :package-id="activeWork.packageId"
      :view-id="activeWork.viewId"
      :port="port"
      :title="activePackage?.manifest.name ?? activeWork.title"
      :icon="activePackage?.manifest.icon"
    />
  </KeepAlive>
  <KeepAlive>
    <PackageRunView
      v-if="activeWork?.kind === 'package-run'"
      :key="activeWork.id"
      :package-id="activeWork.packageId"
      :run-id="activeWork.runId"
      :packages="packages"
      @open-package="emit('openPackage', $event)"
    />
  </KeepAlive>
  <KeepAlive>
    <AgentSessionView
      v-if="activeWork?.kind === 'agent-session'"
      :key="activeWork.id"
      :agent-id="activeWork.agentId"
      :session-id="activeWork.sessionId"
      @open-agent-session="(agentId, sessionId) => emit('openAgentSession', agentId, sessionId)"
    />
  </KeepAlive>
</template>
