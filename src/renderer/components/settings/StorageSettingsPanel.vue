<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'
import MimSegmented from '../ui/MimSegmented.vue'
import MimToggle from '../ui/MimToggle.vue'
import { useSettingsStore } from '../../stores/settings.js'

interface HistoryStats {
  bytes: number
  blobBytes: number
  fileCount: number
  versionCount: number
  prunedVersionCount?: number
}

interface SyncStatus {
  mode: 'manual' | 'managed'
  state: 'manual' | 'not-configured' | 'synced' | 'needs-sync' | 'stopped'
  git: boolean
  remote: string | null
  dirty: boolean
  ahead: boolean
  behind: boolean
  conflicts: string[]
  message: string
}

const history = ref<HistoryStats | null>(null)
const sync = ref<SyncStatus | null>(null)
const busy = ref('')
const error = ref('')
const remote = ref('')
const settings = useSettingsStore()
const syncModeOptions = [
  { value: 'manual', label: 'Manual', title: 'Mim reports sync state but does not run git automatically.' },
  { value: 'managed', label: 'Managed', title: 'Mim can commit, pull, and push when you choose Sync now.' },
]

const historyLabel = computed(() =>
  history.value
    ? `${formatBytes(history.value.bytes)} · ${history.value.versionCount.toLocaleString()} versions`
    : 'Loading'
)

const canPrune = computed(() => (history.value?.prunedVersionCount ?? 0) > 0)
const syncLabel = computed(() => sync.value ? sync.value.message : 'Loading')
const canSyncNow = computed(() =>
  sync.value?.mode === 'managed' &&
  sync.value.git &&
  Boolean(sync.value.remote) &&
  sync.value.conflicts.length === 0
)
const syncNowDesc = computed(() => {
  if (!sync.value) return ''
  if (sync.value.mode !== 'managed') return 'Switch to managed sync first'
  if (!sync.value.git) return 'Initialize managed sync first'
  if (!sync.value.remote) return 'Add a remote before syncing'
  if (sync.value.conflicts.length > 0) return 'Resolve conflicts before syncing again'
  return sync.value.state === 'synced' ? 'No changes waiting' : ''
})

onMounted(refresh)

async function refresh() {
  error.value = ''
  await Promise.all([loadHistory(), loadSync()])
}

async function loadHistory() {
  try {
    history.value = normalizeHistoryStats(await window.kernel.call('history.stats'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadSync() {
  try {
    sync.value = normalizeSyncStatus(await window.kernel.call('sync.status'))
    if (sync.value.remote) remote.value = sync.value.remote
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function pruneHistory() {
  busy.value = 'prune'
  try {
    await window.kernel.call('history.prune')
    await loadHistory()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function clearHistory() {
  if (!confirm('Clear local history? Workspace files are not deleted.')) return
  busy.value = 'clear'
  try {
    await window.kernel.call('history.clear')
    await loadHistory()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function configureSync(mode: 'manual' | 'managed') {
  busy.value = mode
  try {
    await window.kernel.call('sync.configure', {
      mode,
      ...(mode === 'managed' && remote.value.trim() ? { remote: remote.value.trim() } : {}),
    })
    await loadSync()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

function onSyncModeUpdate(value: string) {
  if (value === 'manual' || value === 'managed') void configureSync(value)
}

async function syncNow() {
  busy.value = 'sync'
  try {
    sync.value = await window.kernel.call('sync.now') as SyncStatus
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    await loadSync()
  } finally {
    busy.value = ''
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function normalizeHistoryStats(raw: unknown): HistoryStats {
  const value = objectRecord(raw)
  return {
    bytes: numberOrZero(value.bytes),
    blobBytes: numberOrZero(value.blobBytes),
    fileCount: numberOrZero(value.fileCount),
    versionCount: numberOrZero(value.versionCount),
    prunedVersionCount: numberOrZero(value.prunedVersionCount),
  }
}

function normalizeSyncStatus(raw: unknown): SyncStatus {
  const value = objectRecord(raw)
  const mode = value.mode === 'managed' ? 'managed' : 'manual'
  const state = typeof value.state === 'string' && ['manual', 'not-configured', 'synced', 'needs-sync', 'stopped'].includes(value.state)
    ? value.state as SyncStatus['state']
    : mode === 'managed' ? 'not-configured' : 'manual'
  const remoteValue = typeof value.remote === 'string' && value.remote.trim() ? value.remote : null
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts.filter((item): item is string => typeof item === 'string')
    : []
  return {
    mode,
    state,
    git: value.git === true,
    remote: remoteValue,
    dirty: value.dirty === true,
    ahead: value.ahead === true,
    behind: value.behind === true,
    conflicts,
    message: typeof value.message === 'string' && value.message.trim() ? value.message : 'Manual sync',
  }
}

function objectRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="Storage settings">
    <SettingsGroup title="Recovery">
      <SettingRow label="History" :desc="historyLabel">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid disabled:opacity-40"
            :disabled="busy !== '' || !canPrune"
            @click="pruneHistory"
          >
            Thin old versions
          </button>
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-rem hover:bg-chrome-mid disabled:opacity-40"
            :disabled="busy !== '' || !history"
            @click="clearHistory"
          >
            Clear local history
          </button>
        </div>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup title="Sync">
      <SettingRow label="Workspace" :desc="syncLabel">
        <MimSegmented
          :model-value="sync?.mode ?? 'manual'"
          :options="syncModeOptions"
          aria-label="Sync mode"
          :disabled="busy !== ''"
          @update:model-value="onSyncModeUpdate"
        />
      </SettingRow>

      <SettingRow label="Remote" :desc="sync?.remote || 'No remote configured'">
        <div class="flex min-w-[280px] items-center gap-2">
          <input
            v-model="remote"
            type="text"
            class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
            placeholder="https://github.com/org/repo.git"
          >
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid disabled:opacity-40"
            :disabled="busy !== ''"
            @click="configureSync('managed')"
          >
            Save
          </button>
        </div>
      </SettingRow>

      <SettingRow label="Sync now" :desc="syncNowDesc">
        <button
          type="button"
          class="h-7 rounded-[5px] bg-accent px-3 text-[12px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-40"
          :disabled="busy !== '' || !canSyncNow"
          @click="syncNow"
        >
          Sync now
        </button>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup title="Analytics">
      <SettingRow
        label="Usage data"
        :desc="settings.telemetryLocked ? 'Disabled by environment' : 'Anonymous counts only. No files, prompts, or paths.'"
      >
        <MimToggle
          :model-value="settings.telemetryEnabled"
          :disabled="settings.telemetryLocked"
          aria-label="Share anonymous usage data"
          @update:model-value="settings.setTelemetryEnabled"
        />
      </SettingRow>
    </SettingsGroup>

    <p v-if="error" class="m-0 text-[11px] text-rem">{{ error }}</p>
  </section>
</template>
