<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'
import MimSegmented from '../ui/MimSegmented.vue'
import MimSelect from '../ui/MimSelect.vue'
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

interface TraceStorageStats {
  digestBytes: number
  payloadBytes: number
  payloadCount: number
  totalBytes: number
}

const history = ref<HistoryStats | null>(null)
const traceStorage = ref<TraceStorageStats | null>(null)
const sync = ref<SyncStatus | null>(null)
const busy = ref('')
const error = ref('')
const remote = ref('')
const advancedOpen = ref(false)
const settings = useSettingsStore()
const syncModeOptions = [
  { value: 'manual', label: 'Manual', title: 'Mim reports sync state but does not run git automatically.' },
  { value: 'managed', label: 'Managed', title: 'Mim can commit, pull, and push when you choose Sync now.' },
]
const historyBudgetOptions = [
  { value: 256 * 1024 * 1024, label: '256 MB' },
  { value: 512 * 1024 * 1024, label: '512 MB' },
  { value: 1024 * 1024 * 1024, label: '1 GB' },
  { value: 2 * 1024 * 1024 * 1024, label: '2 GB' },
]
const traceRetentionOptions = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
]
const tracePayloadRetentionOptions = [
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]
const tracePayloadBudgetOptions = [
  { value: 100 * 1024 * 1024, label: '100 MB' },
  { value: 250 * 1024 * 1024, label: '250 MB' },
  { value: 500 * 1024 * 1024, label: '500 MB' },
  { value: 1024 * 1024 * 1024, label: '1 GB' },
]

const historyLabel = computed(() =>
  history.value
    ? `${formatBytes(history.value.bytes)} · ${history.value.versionCount.toLocaleString()} versions`
    : 'Loading'
)

const canPrune = computed(() => (history.value?.prunedVersionCount ?? 0) > 0)
const auditTrailEnabled = computed(() => settings.traceRetentionDays > 0)
const traceStorageLabel = computed(() =>
  traceStorage.value
    ? `${formatBytes(traceStorage.value.digestBytes)} audit · ${formatBytes(traceStorage.value.payloadBytes)} content`
    : 'Loading'
)
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
  await Promise.all([loadHistory(), loadTraceStorage(), loadSync()])
}

async function loadHistory() {
  try {
    history.value = normalizeHistoryStats(await window.kernel.call('history.stats'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadTraceStorage() {
  try {
    traceStorage.value = normalizeTraceStorageStats(await window.kernel.call('trace.storage'))
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

async function pruneTraces() {
  busy.value = 'trace-prune'
  try {
    await window.kernel.call('trace.prune')
    await loadTraceStorage()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function updateHistoryEnabled(value: boolean) {
  if (value === settings.historyEnabled) return
  if (
    !value
    && !confirm(
      'Turn off file recovery? Mim will stop saving new file recovery points. Existing versions remain available until you clear them in Advanced.',
    )
  ) return

  busy.value = 'history-enabled'
  try {
    await settings.set('historyEnabled', value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function updateAuditTrailEnabled(value: boolean) {
  if (value === auditTrailEnabled.value) return
  if (
    !value
    && !confirm(
      'Turn off the local audit trail? This will delete the existing local audit trail and retained trace content for this workspace.',
    )
  ) return

  busy.value = 'audit-enabled'
  try {
    await settings.set('traceRetentionDays', value ? 90 : 0)
    await loadTraceStorage()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function updateHistoryBudget(value: string | number) {
  if (typeof value !== 'number') return
  busy.value = 'history-budget'
  try {
    await settings.set('historyMaxBytes', value)
    await window.kernel.call('history.prune')
    await loadHistory()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function updateTracePolicy(key: 'traceRetentionDays' | 'tracePayloadRetentionDays' | 'tracePayloadMaxBytes', value: string | number) {
  if (typeof value !== 'number') return
  busy.value = key
  try {
    await settings.set(key, value)
    await window.kernel.call('trace.prune')
    await loadTraceStorage()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

function updateTraceCaptureContent(value: boolean) {
  void settings.set('traceCaptureContent', value)
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

function normalizeTraceStorageStats(raw: unknown): TraceStorageStats {
  const value = objectRecord(raw)
  return {
    digestBytes: numberOrZero(value.digestBytes),
    payloadBytes: numberOrZero(value.payloadBytes),
    payloadCount: numberOrZero(value.payloadCount),
    totalBytes: numberOrZero(value.totalBytes),
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
    <SettingsGroup title="Local records">
      <SettingRow label="File recovery" desc="Keep previous versions when files are changed or deleted.">
        <MimToggle
          :model-value="settings.historyEnabled"
          aria-label="Keep file recovery"
          title="Keep file recovery"
          :disabled="busy !== ''"
          @update:model-value="updateHistoryEnabled"
        />
      </SettingRow>

      <SettingRow label="Local audit trail" desc="Keep a private record of actions in this workspace.">
        <MimToggle
          :model-value="auditTrailEnabled"
          aria-label="Keep local audit trail"
          title="Keep local audit trail"
          :disabled="busy !== ''"
          @update:model-value="updateAuditTrailEnabled"
        />
      </SettingRow>

      <SettingRow label="Advanced" desc="Storage use, retention, limits, and cleanup.">
        <button
          type="button"
          class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
          :title="advancedOpen ? 'Hide advanced local record settings' : 'Show advanced local record settings'"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
        >
          {{ advancedOpen ? 'Hide' : 'Show' }}
        </button>
      </SettingRow>

      <template v-if="advancedOpen">
        <SettingRow label="Recovery storage" :desc="historyLabel">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid disabled:opacity-40"
              title="Apply history compaction and the storage budget now"
              :disabled="busy !== '' || !canPrune"
              @click="pruneHistory"
            >
              Optimize history
            </button>
            <button
              type="button"
              class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-rem hover:bg-chrome-mid disabled:opacity-40"
              title="Delete every local recovery point"
              :disabled="busy !== '' || !history"
              @click="clearHistory"
            >
              Clear local history
            </button>
          </div>
        </SettingRow>

        <SettingRow label="History budget" desc="Soft limit; recent and destructive recovery points stay protected.">
          <MimSelect
            :model-value="settings.historyMaxBytes"
            :options="historyBudgetOptions"
            aria-label="History budget"
            :disabled="busy !== '' || !settings.historyEnabled"
            @update:model-value="updateHistoryBudget"
          />
        </SettingRow>

        <SettingRow label="Audit storage" :desc="traceStorageLabel">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid disabled:opacity-40"
            title="Apply audit retention and the content budget now"
            :disabled="busy !== '' || !traceStorage"
            @click="pruneTraces"
          >
            Clean now
          </button>
        </SettingRow>

        <SettingRow label="Audit retention" desc="Compact event records; no raw file contents.">
          <MimSelect
            :model-value="settings.traceRetentionDays"
            :options="traceRetentionOptions"
            aria-label="Audit retention"
            :disabled="busy !== '' || !auditTrailEnabled"
            @update:model-value="value => updateTracePolicy('traceRetentionDays', value)"
          />
        </SettingRow>

        <SettingRow label="Keep content" desc="Completed model turns and consequential tool results. File-write details stay on for accountability.">
          <MimToggle
            :model-value="settings.traceCaptureContent"
            aria-label="Keep trace content"
            title="Keep trace content"
            :disabled="busy !== '' || !auditTrailEnabled"
            @update:model-value="updateTraceCaptureContent"
          />
        </SettingRow>

        <SettingRow label="Content retention" desc="Retained content expires independently of audit events.">
          <MimSelect
            :model-value="settings.tracePayloadRetentionDays"
            :options="tracePayloadRetentionOptions"
            aria-label="Trace content retention"
            :disabled="busy !== '' || !auditTrailEnabled"
            @update:model-value="value => updateTracePolicy('tracePayloadRetentionDays', value)"
          />
        </SettingRow>

        <SettingRow label="Content budget" desc="Soft limit; recent file-write details stay protected.">
          <MimSelect
            :model-value="settings.tracePayloadMaxBytes"
            :options="tracePayloadBudgetOptions"
            aria-label="Trace content budget"
            :disabled="busy !== '' || !auditTrailEnabled"
            @update:model-value="value => updateTracePolicy('tracePayloadMaxBytes', value)"
          />
        </SettingRow>
      </template>
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
            title="Git remote URL"
          >
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid disabled:opacity-40"
            title="Save the managed sync remote"
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
          title="Synchronize the workspace with its remote"
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
          title="Share anonymous usage data"
          @update:model-value="settings.setTelemetryEnabled"
        />
      </SettingRow>
    </SettingsGroup>

    <p v-if="error" class="m-0 text-[11px] text-rem">{{ error }}</p>
  </section>
</template>
