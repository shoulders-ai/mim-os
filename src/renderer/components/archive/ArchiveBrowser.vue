<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useSessionStore, type Session } from '../../stores/sessions.js'
import {
  packageRunDisplayTitle,
  useRunsStore,
  type AgentSessionRuntime,
  type PackageRunRecord,
} from '../../stores/runs.js'
import { useAgentsStore } from '../../stores/agents.js'
import { useAppAgentsStore } from '../../stores/appAgents.js'
import { relativeTime } from '../../services/relativeTime.js'
import ArchiveCard from './ArchiveCard.vue'

const props = withDefaults(defineProps<{
  active?: boolean
  refreshKey?: number
}>(), {
  active: true,
  refreshKey: 0,
})

const emit = defineEmits<{
  openSession: [id: string]
  openPackageRun: [packageId: string, runId: string]
  openAgentSession: [agentId: string, sessionId: string]
}>()

const sessionStore = useSessionStore()
const runsStore = useRunsStore()
const agentsStore = useAgentsStore()
const appAgentsStore = useAppAgentsStore()

interface ArchiveItem {
  id: string
  kind: 'session' | 'package-run' | 'agent-session'
  label: string
  updatedAt: string
  messageCount: number
  preview: string
  previewHtml?: string
  archived: boolean
  packageId?: string
  agentId?: string
  status?: string
  meta?: string
}

const query = ref('')
const items = ref<ArchiveItem[]>([])
const loading = ref(false)
const searching = computed(() => query.value.trim().length >= 2)

let debounce: ReturnType<typeof setTimeout> | null = null

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The FTS snippet wraps matches in << >>; turn those into <mark> after escaping.
function highlight(excerpt: string): string {
  return escapeHtml(excerpt).replaceAll('&lt;&lt;', '<mark>').replaceAll('&gt;&gt;', '</mark>')
}

async function loadBrowse() {
  loading.value = true
  try {
    const result = await window.kernel.call('archive.list') as {
      sessions?: Array<Omit<ArchiveItem, 'kind' | 'archived'>>
      packageRuns?: Array<{
        id: string
        packageId: string
        label: string
        updatedAt: string
        eventCount: number
        status: string
        preview: string
      }>
      agentSessions?: Array<{
        id: string
        agentId: string
        label: string
        updatedAt: string
        status: string
        preview: string
      }>
    }

    const byKey = new Map<string, ArchiveItem>()
    const setItem = (item: ArchiveItem) => {
      byKey.set(`${item.kind}:${item.id}`, item)
    }

    for (const session of sessionStore.sessions) {
      setItem(sessionToHistoryItem(session))
    }

    for (const run of runsStore.packageRuns) {
      setItem(packageRunToHistoryItem(run))
    }

    for (const session of runsStore.agentSessions) {
      setItem(agentSessionToHistoryItem(session))
    }

    if (Array.isArray(result?.sessions)) {
      for (const item of result.sessions) {
        const existing = byKey.get(`session:${item.id}`)
        const sessionAgentId = (item as { agentId?: string }).agentId ?? existing?.agentId
        setItem({
          ...existing,
          ...item,
          kind: 'session',
          archived: true,
          agentId: sessionAgentId,
          meta: appAgentMeta(sessionAgentId, 'Archived chat'),
        })
      }
    }

    if (Array.isArray(result?.packageRuns)) {
      for (const run of result.packageRuns) {
        const existing = byKey.get(`package-run:${run.id}`)
        setItem({
          ...existing,
          id: run.id,
          kind: 'package-run',
          label: run.label,
          updatedAt: run.updatedAt,
          messageCount: run.eventCount,
          preview: run.preview,
          archived: true,
          packageId: run.packageId,
          status: run.status,
          meta: `Archived run / ${run.eventCount} ${run.eventCount === 1 ? 'event' : 'events'} / ${run.status}`,
        })
      }
    }

    if (Array.isArray(result?.agentSessions)) {
      for (const session of result.agentSessions) {
        const existing = byKey.get(`agent-session:${session.id}`)
        setItem({
          ...existing,
          id: session.id,
          kind: 'agent-session',
          label: session.label,
          updatedAt: session.updatedAt,
          messageCount: 0,
          preview: session.preview,
          archived: true,
          agentId: session.agentId,
          status: session.status,
          meta: `Archived agent session / ${agentName(session.agentId)} / ${session.status}`,
        })
      }
    }

    items.value = [...byKey.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } finally {
    loading.value = false
  }
}

function appAgentMeta(agentId: string | undefined, prefix: string): string {
  if (!agentId) return prefix
  const mount = appAgentsStore.byId(agentId)
  return mount ? `${prefix} / ${mount.name}` : prefix
}

function sessionToHistoryItem(session: Session): ArchiveItem {
  const base = session.archived ? 'Archived chat' : 'Active chat'
  return {
    id: session.id,
    kind: 'session',
    label: session.label,
    updatedAt: session.updatedAt,
    messageCount: session.messages?.length ?? 0,
    preview: sessionPreview(session),
    archived: session.archived,
    agentId: session.agentId,
    meta: appAgentMeta(session.agentId, base),
  }
}

function packageRunToHistoryItem(run: PackageRunRecord): ArchiveItem {
  const eventCount = run.events?.length ?? 0
  return {
    id: run.runId,
    kind: 'package-run',
    label: packageRunDisplayTitle(run),
    updatedAt: run.completedAt ?? run.startedAt,
    messageCount: eventCount,
    preview: packageRunPreview(run),
    archived: run.archived === true,
    packageId: run.packageId,
    status: run.status,
    meta: `${run.archived ? 'Archived' : 'Active'} run / ${eventCount} ${eventCount === 1 ? 'event' : 'events'} / ${run.status}`,
  }
}

function agentName(agentId: string): string {
  return agentsStore.agents.find(agent => agent.id === agentId)?.name ?? agentId
}

function agentSessionToHistoryItem(session: AgentSessionRuntime): ArchiveItem {
  return {
    id: session.sessionId,
    kind: 'agent-session',
    label: session.title,
    updatedAt: session.endedAt ?? session.startedAt,
    messageCount: 0,
    preview: session.titleHint ?? '',
    archived: session.archived === true,
    agentId: session.agentId,
    status: session.status,
    meta: `${session.archived ? 'Archived' : 'Active'} agent session / ${agentName(session.agentId)} / ${session.status}`,
  }
}

function sessionPreview(session: Session): string {
  for (const message of session.messages ?? []) {
    if (message.role === 'system') continue
    if (typeof message.content === 'string' && message.content.trim()) {
      return collapsePreview(message.content)
    }
  }
  return ''
}

function packageRunPreview(run: PackageRunRecord): string {
  const latest = [...(run.events ?? [])].reverse().find(event => {
    const data = event.data ?? {}
    return typeof data.label === 'string'
      || typeof data.name === 'string'
      || typeof data.message === 'string'
      || typeof data.error === 'string'
  })
  if (!latest) return ''
  const data = latest.data ?? {}
  const value = data.label ?? data.name ?? data.message ?? data.error
  return typeof value === 'string' ? collapsePreview(value) : ''
}

function collapsePreview(value: string): string {
  const text = value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 3).join(' ')
  return text.length > 240 ? `${text.slice(0, 240).trimEnd()}...` : text
}

async function runSearch(q: string) {
  loading.value = true
  try {
    const result = await window.kernel.call('search.sessions', { query: q }) as {
      results: Array<{ sessionId: string; label: string; excerpt: string }>
    }
    const seen = new Set<string>()
    items.value = (result?.results ?? []).flatMap((r) => {
      if (seen.has(r.sessionId)) return []
      seen.add(r.sessionId)
      const session = sessionStore.sessions.find(item => item.id === r.sessionId)
      return [{
        id: r.sessionId,
        kind: 'session' as const,
        label: r.label || session?.label || 'Chat',
        updatedAt: session?.updatedAt ?? '',
        messageCount: session?.messages?.length ?? 0,
        preview: '',
        previewHtml: highlight(r.excerpt),
        archived: session?.archived === true,
        agentId: session?.agentId,
        meta: appAgentMeta(session?.agentId, session?.archived ? 'Archived chat' : 'Active chat'),
      }]
    })
  } finally {
    loading.value = false
  }
}

function refresh() {
  if (searching.value) runSearch(query.value.trim())
  else loadBrowse()
}

watch(query, (q) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    if (q.trim().length >= 2) runSearch(q.trim())
    else loadBrowse()
  }, 220)
})

async function open(id: string) {
  const item = items.value.find(candidate => candidate.id === id)
  if (item?.kind === 'package-run' && item.packageId) {
    if (item.archived) {
      await window.kernel.call('package.jobs.restore', { runId: id })
    }
    emit('openPackageRun', item.packageId, id)
    refresh()
    return
  }

  if (item?.kind === 'agent-session') {
    if (item.archived) {
      const result = await window.kernel.call('agent.sessions.archive', {
        sessionId: id,
        archived: false,
      }) as { session?: AgentSessionRuntime }
      if (result.session) {
        runsStore.applyAgentSessionEvent({ type: 'session.changed', session: result.session })
      }
    }
    emit('openAgentSession', item.agentId ?? '', id)
    refresh()
    return
  }

  if (item?.archived) {
    await sessionStore.restore(id)
  }
  await sessionStore.select(id)
  emit('openSession', id)
  refresh()
}

async function remove(id: string) {
  const item = items.value.find(candidate => candidate.id === id)
  if (item?.kind === 'package-run') {
    await window.kernel.call('package.jobs.delete', { runId: id })
    refresh()
    return
  }
  if (item?.kind === 'agent-session') {
    await window.kernel.call('agent.sessions.delete', { sessionId: id })
    runsStore.removeAgentSession(id)
    refresh()
    return
  }
  await sessionStore.remove(id)
  refresh()
}

watch(
  () => props.active,
  (active) => {
    if (active) refresh()
  },
)

watch(
  () => props.refreshKey,
  () => {
    if (props.active) refresh()
  },
)

onMounted(loadBrowse)
</script>

<template>
  <div class="flex h-full flex-col bg-surface">
    <!-- Search -->
    <div class="shrink-0 border-b border-rule-light px-4 py-3">
      <div class="flex items-center gap-2 rounded-[7px] border border-rule-light bg-chrome-mid px-2.5 h-8 focus-within:border-accent">
        <svg class="shrink-0 text-ink-4" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          v-model="query"
          type="text"
          placeholder="Search conversation history"
          class="flex-1 min-w-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-4"
          autocorrect="off"
          autocapitalize="off"
        />
        <button
          v-if="query"
          class="shrink-0 rounded-[4px] p-0.5 text-ink-4 hover:bg-chrome-high hover:text-ink-2"
          title="Clear"
          @click="query = ''"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
      <div v-if="items.length" class="flex flex-col gap-2">
        <ArchiveCard
          v-for="item in items"
          :key="`${item.kind}:${item.id}`"
          :label="item.label"
          :preview="item.preview"
          :preview-html="item.previewHtml"
          :date="relativeTime(item.updatedAt)"
          :message-count="item.messageCount"
          :meta="item.meta"
          @open="open(item.id)"
          @remove="remove(item.id)"
        />
      </div>

      <div v-else-if="loading" class="px-1 py-6 text-center text-[12px] text-ink-4">Loading…</div>

      <div v-else-if="searching" class="px-1 py-10 text-center text-[12px] text-ink-4">
        No conversations match “{{ query.trim() }}”.
      </div>

      <div v-else class="px-1 py-10 text-center text-[12px] text-ink-4">
        No history yet. Chats and app runs will appear here.
      </div>
    </div>
  </div>
</template>
