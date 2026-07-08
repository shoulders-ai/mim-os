<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ResourcesSettingsPanel from './ResourcesSettingsPanel.vue'
import StorageSettingsPanel from './StorageSettingsPanel.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

interface SharedWorkspaceStatus {
  configured: boolean
  id?: string
  name?: string
  url?: string
  namespaces?: string[]
  tokenConfigured?: boolean
  tokenKey?: string
}

interface SharedWorkspaceInvitePreview {
  workspaceId: string
  workspaceName: string
  callerName: string
  host: string
  namespaces: string[]
}

const sharedWorkspace = ref<SharedWorkspaceStatus | null>(null)
const sharedWorkspaceError = ref('')
const inviteText = ref('')
const invitePreview = ref<SharedWorkspaceInvitePreview | null>(null)
const inviteError = ref('')
const joinMessage = ref('')
const joining = ref(false)

const sharedWorkspaceLabel = computed(() => {
  if (!sharedWorkspace.value) return 'Loading'
  if (!sharedWorkspace.value.configured) return 'Local only'
  return sharedWorkspace.value.tokenConfigured ? 'Connected' : 'Invite needed'
})

const sharedWorkspaceDesc = computed(() => {
  if (!sharedWorkspace.value) return ''
  if (!sharedWorkspace.value.configured) return 'Opening a folder is enough. Join only when someone sends an invite'
  return sharedWorkspace.value.tokenConfigured
    ? `${sharedWorkspaceName.value} provides ${namespaceLabel(sharedWorkspace.value.namespaces ?? [])}`
    : 'Ask for a fresh invite to reconnect this workspace'
})

const sharedWorkspaceName = computed(() =>
  sharedWorkspace.value?.name || sharedWorkspace.value?.id || 'Shared workspace',
)

const sharedWorkspaceHost = computed(() => {
  const url = sharedWorkspace.value?.url
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
})

const canReviewInvite = computed(() => inviteText.value.trim().length > 0 && !joining.value)
const canJoinInvite = computed(() => inviteText.value.trim().length > 0 && !joining.value)
const showJoin = computed(() => sharedWorkspace.value?.configured !== true || sharedWorkspace.value?.tokenConfigured !== true)

const previewSentence = computed(() => {
  if (!invitePreview.value) return ''
  return `Files stay on this machine. ${namespaceLabel(invitePreview.value.namespaces)} come from ${invitePreview.value.workspaceName}.`
})

onMounted(() => {
  void loadSharedWorkspace()
  window.kernel.on('workspace:changed', onWorkspaceChanged)
  window.kernel.on('shared-workspace:invite', onSharedWorkspaceInvite)
  void consumePendingInvites()
})

onUnmounted(() => {
  window.kernel.off('workspace:changed', onWorkspaceChanged)
  window.kernel.off('shared-workspace:invite', onSharedWorkspaceInvite)
})

function onWorkspaceChanged() {
  void loadSharedWorkspace()
}

async function loadSharedWorkspace() {
  sharedWorkspaceError.value = ''
  try {
    sharedWorkspace.value = normalizeSharedWorkspaceStatus(
      await window.kernel.call('workspace.sharedWorkspace.status'),
    )
  } catch (err) {
    sharedWorkspace.value = { configured: false }
    sharedWorkspaceError.value = err instanceof Error ? err.message : String(err)
  }
}

function onSharedWorkspaceInvite(invite: unknown) {
  if (typeof invite !== 'string' || !invite.trim()) return
  inviteText.value = invite
  void window.kernel.consumeSharedWorkspaceInvites?.()
  void reviewInvite()
}

async function consumePendingInvites() {
  const pending = await window.kernel.consumeSharedWorkspaceInvites?.()
  if (!Array.isArray(pending) || pending.length === 0) return
  const invite = pending.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (!invite) return
  inviteText.value = invite
  await reviewInvite()
}

async function reviewInvite() {
  inviteError.value = ''
  joinMessage.value = ''
  invitePreview.value = null
  const invite = inviteText.value.trim()
  if (!invite) return
  try {
    invitePreview.value = normalizeInvitePreview(
      await window.kernel.call('workspace.sharedWorkspace.inspectInvite', { invite }),
    )
  } catch (err) {
    inviteError.value = err instanceof Error ? err.message : String(err)
  }
}

async function joinInvite() {
  inviteError.value = ''
  joinMessage.value = ''
  const invite = inviteText.value.trim()
  if (!invite) return
  joining.value = true
  try {
    const result = await window.kernel.call('workspace.sharedWorkspace.join', { invite }) as Record<string, unknown>
    inviteText.value = ''
    invitePreview.value = null
    joinMessage.value = `Connected to ${joinedWorkspaceName(result)}`
    await loadSharedWorkspace()
  } catch (err) {
    inviteError.value = err instanceof Error ? err.message : String(err)
  } finally {
    joining.value = false
  }
}

function normalizeSharedWorkspaceStatus(raw: unknown): SharedWorkspaceStatus {
  if (!raw || typeof raw !== 'object') return { configured: false }
  const source = raw as Record<string, unknown>
  if (source.configured !== true) return { configured: false }
  return {
    configured: true,
    id: typeof source.id === 'string' ? source.id : '',
    name: typeof source.name === 'string' ? source.name : '',
    url: typeof source.url === 'string' ? source.url : '',
    namespaces: Array.isArray(source.namespaces)
      ? source.namespaces.filter((item): item is string => typeof item === 'string')
      : [],
    tokenConfigured: source.tokenConfigured === true,
    tokenKey: typeof source.tokenKey === 'string' ? source.tokenKey : '',
  }
}

function normalizeInvitePreview(raw: unknown): SharedWorkspaceInvitePreview {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid shared workspace invite')
  const source = raw as Record<string, unknown>
  return {
    workspaceId: typeof source.workspaceId === 'string' ? source.workspaceId : '',
    workspaceName: typeof source.workspaceName === 'string' ? source.workspaceName : 'Shared workspace',
    callerName: typeof source.callerName === 'string' ? source.callerName : '',
    host: typeof source.host === 'string' ? source.host : '',
    namespaces: Array.isArray(source.namespaces)
      ? source.namespaces.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function namespaceLabel(namespaces: string[]): string {
  const labels = [...new Set(namespaces.map(namespace => namespace.replace(/\.\*$/, '').split('.')[0]).filter(Boolean))]
    .map(label => label.slice(0, 1).toUpperCase() + label.slice(1))
  if (labels.length === 0) return 'selected team tools'
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

function joinedWorkspaceName(result: Record<string, unknown>): string {
  const shared = result.sharedWorkspace
  if (shared && typeof shared === 'object' && !Array.isArray(shared)) {
    const name = (shared as Record<string, unknown>).name
    const id = (shared as Record<string, unknown>).id
    if (typeof name === 'string' && name) return name
    if (typeof id === 'string' && id) return id
  }
  return 'shared workspace'
}
</script>

<template>
  <section class="flex flex-col gap-8 text-ink" aria-label="Workspace settings">
    <SettingsGroup title="Shared workspace">
      <SettingRow label="Shared workspace" :desc="sharedWorkspaceDesc">
        <span
          class="rounded-[999px] px-2 py-1 text-[10px] font-medium"
          :class="sharedWorkspace?.configured
            ? sharedWorkspace.tokenConfigured
              ? 'bg-ok/10 text-ok'
              : 'bg-warn/10 text-warn'
            : 'bg-chrome-mid text-ink-3'"
        >
          {{ sharedWorkspaceLabel }}
        </span>
      </SettingRow>

      <div
        v-if="sharedWorkspace?.configured"
        class="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-rule-light py-3 text-[11px] last:border-b-0"
      >
        <span class="text-ink-3">Workspace</span>
        <span class="min-w-0 truncate font-sans text-ink-2">{{ sharedWorkspaceName }}</span>
        <span class="text-ink-3">Host</span>
        <span class="min-w-0 truncate font-mono text-ink-2">{{ sharedWorkspaceHost }}</span>
        <span class="text-ink-3">Shared tools</span>
        <span class="min-w-0 truncate font-sans text-ink-2">{{ namespaceLabel(sharedWorkspace.namespaces ?? []) }}</span>
      </div>

      <div v-if="showJoin" class="border-b border-rule-light py-3 last:border-b-0">
        <label class="mb-1.5 block font-sans text-[11px] font-[620] text-ink-2" for="shared-workspace-invite">
          Join shared workspace
        </label>
        <textarea
          id="shared-workspace-invite"
          v-model="inviteText"
          class="min-h-[68px] w-full resize-y rounded-[6px] border border-rule-light bg-surface px-2.5 py-2 font-mono text-[11px] leading-[1.4] text-ink outline-none hover:bg-chrome-high focus:border-rule"
          placeholder="Paste invite"
          spellcheck="false"
        />
        <div class="mt-2 flex items-center justify-end gap-1.5">
          <button
            type="button"
            class="inline-flex h-7 items-center rounded-[6px] border border-rule px-2.5 font-sans text-[11px] font-[620] text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:text-ink-4"
            :disabled="!canReviewInvite"
            @click="reviewInvite"
          >
            Review invite
          </button>
          <button
            type="button"
            class="inline-flex h-7 items-center rounded-[6px] bg-ink px-3 font-sans text-[11px] font-[650] text-surface hover:bg-accent hover:text-accent-ink disabled:bg-chrome-mid disabled:text-ink-4"
            :disabled="!canJoinInvite"
            @click="joinInvite"
          >
            {{ joining ? 'Joining' : 'Join' }}
          </button>
        </div>

        <div
          v-if="invitePreview"
          class="mt-2 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-[6px] border border-rule-light bg-chrome-high px-2.5 py-2 text-[11px]"
        >
          <span class="text-ink-3">Workspace</span>
          <span class="min-w-0 truncate font-sans text-ink-2">{{ invitePreview.workspaceName }}</span>
          <span class="text-ink-3">Host</span>
          <span class="min-w-0 truncate font-mono text-ink-2">{{ invitePreview.host }}</span>
          <span class="text-ink-3">You</span>
          <span class="min-w-0 truncate font-sans text-ink-2">{{ invitePreview.callerName }}</span>
          <p class="col-span-2 m-0 pt-1 font-sans text-[11px] leading-[1.4] text-ink-3">{{ previewSentence }}</p>
        </div>

        <p v-if="inviteError" class="m-0 mt-2 text-[11px] leading-[1.4] text-rem">{{ inviteError }}</p>
        <p v-if="joinMessage" class="m-0 mt-2 text-[11px] leading-[1.4] text-ok">{{ joinMessage }}</p>
      </div>

      <p v-if="sharedWorkspaceError" class="m-0 border-b border-rule-light py-2 text-[11px] text-rem">
        {{ sharedWorkspaceError }}
      </p>
    </SettingsGroup>
    <ResourcesSettingsPanel />
    <StorageSettingsPanel />
  </section>
</template>
