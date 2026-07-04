<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MimToggle from '../ui/MimToggle.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'
import { buildInterpreterRows, type InterpreterRowVM, type ToolchainEntry } from './codeInterpreterRows'

type ToolDomain = 'files' | 'terminal' | 'code' | 'git' | 'web' | 'slack' | 'google' | 'apps' | 'system'

interface ToolPolicyRow {
  id: string
  domain: ToolDomain
  label: string
  description?: string
  toolIds: string[]
  aiToolKeys?: string[]
  mcpToolNames?: string[]
  connectionKey?: 'slack' | 'google'
  risk?: 'normal' | 'sensitive' | 'outbound'
  enabled: boolean
}

interface ToolPolicyResponse {
  policy?: {
    rows?: ToolPolicyRow[]
    enabled?: string[]
    disabled?: string[]
    explicit?: boolean
  }
}

interface SlackStatus {
  configured?: boolean
  auth?: { team?: string; user?: string }
}

interface GoogleStatus {
  configured?: boolean
  tokenConfigured?: boolean
  auth?: { email?: string; name?: string }
  account?: string
  grantedScopes?: string[]
}

const DOMAIN_ORDER: ToolDomain[] = ['files', 'terminal', 'code', 'git', 'web', 'slack', 'google', 'apps', 'system']
const DOMAIN_LABELS: Record<ToolDomain, string> = {
  files: 'Files',
  terminal: 'Terminal',
  code: 'Code execution',
  git: 'Git',
  web: 'Web',
  slack: 'Slack',
  google: 'Google',
  apps: 'Apps',
  system: 'System',
}

const GOOGLE_SCOPES: Record<string, string> = {
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendarRead: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
  driveRead: 'https://www.googleapis.com/auth/drive.readonly',
  drive: 'https://www.googleapis.com/auth/drive',
  sheetsWrite: 'https://www.googleapis.com/auth/spreadsheets',
}

const SCOPE_REQUIREMENTS: Record<string, string[]> = {
  'google.gmail.read': [GOOGLE_SCOPES.gmailRead],
  'google.gmail.send': [GOOGLE_SCOPES.gmailSend],
  'google.calendar.read': [GOOGLE_SCOPES.calendarRead, GOOGLE_SCOPES.calendarWrite],
  'google.calendar.write': [GOOGLE_SCOPES.calendarWrite],
  'google.drive.read': [GOOGLE_SCOPES.driveRead, GOOGLE_SCOPES.drive],
  'google.sheets.write': [GOOGLE_SCOPES.sheetsWrite],
}

const rows = ref<ToolPolicyRow[]>([])
const query = ref('')
const loading = ref(false)
const error = ref('')
const busyRows = ref<Set<string>>(new Set())
const connectionLabels = ref<Record<string, string>>({})
const googleGrantedScopes = ref<Set<string>>(new Set())
const interpreterRows = ref<InterpreterRowVM[]>([])
const interpreterBusy = ref<Set<string>>(new Set())

const filteredRows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(row => searchableText(row).includes(needle))
})

const groupedRows = computed(() => DOMAIN_ORDER
  .map(domain => ({
    domain,
    title: groupTitle(domain),
    rows: filteredRows.value.filter(row => row.domain === domain),
  }))
  .filter(group => group.rows.length > 0))

onMounted(() => {
  void load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [policyResult] = await Promise.all([
      window.kernel.call('toolPolicy.get') as Promise<ToolPolicyResponse>,
      loadConnectionLabels(),
      loadInterpreters(),
    ])
    rows.value = normalizeRows(policyResult.policy?.rows)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function loadInterpreters() {
  try {
    const [toolchain, settings] = await Promise.all([
      window.kernel.call('toolchain.status', {}) as Promise<{ entries?: ToolchainEntry[] }>,
      window.kernel.call('settings.get') as Promise<{ settings: Record<string, unknown> }>,
    ])
    const entries: ToolchainEntry[] = Array.isArray(toolchain?.entries) ? toolchain.entries : []
    const allowlist: string[] = Array.isArray(settings?.settings?.codeInterpreters)
      ? settings.settings.codeInterpreters as string[]
      : ['rscript', 'r', 'quarto']
    interpreterRows.value = buildInterpreterRows(entries, allowlist)
  } catch {
    interpreterRows.value = []
  }
}

async function toggleInterpreter(row: InterpreterRowVM, enabled: boolean) {
  const next = new Set(interpreterBusy.value)
  next.add(row.id)
  interpreterBusy.value = next
  error.value = ''
  try {
    // Read current allowlist, update, write back
    const settings = await window.kernel.call('settings.get') as { settings: Record<string, unknown> }
    const current: string[] = Array.isArray(settings?.settings?.codeInterpreters)
      ? settings.settings.codeInterpreters as string[]
      : ['rscript', 'r', 'quarto']
    const updated = enabled
      ? [...current, row.id]
      : current.filter(id => id !== row.id)
    await window.kernel.call('settings.set', { key: 'codeInterpreters', value: updated })
    // Refresh interpreter rows with new allowlist
    interpreterRows.value = buildInterpreterRows(
      interpreterRows.value.map(r => ({
        id: r.id,
        name: r.label,
        bin: r.id,
        installed: r.installed,
        version: r.versionLabel === 'not found' ? undefined : r.versionLabel,
      })),
      updated,
    )
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    const after = new Set(interpreterBusy.value)
    after.delete(row.id)
    interpreterBusy.value = after
  }
}

async function loadConnectionLabels() {
  const [slack, google] = await Promise.all([
    window.kernel.call('slack.status', {}).catch(() => null) as Promise<SlackStatus | null>,
    window.kernel.call('google.status', {}).catch(() => null) as Promise<GoogleStatus | null>,
  ])
  connectionLabels.value = {
    slack: slack?.configured
      ? [slack.auth?.team, slack.auth?.user].filter(Boolean).join(' · ') || 'Connected'
      : 'Not connected',
    google: google?.configured || google?.tokenConfigured
      ? google.auth?.email || google.account || 'Connected'
      : 'Not connected',
  }
  googleGrantedScopes.value = new Set(
    Array.isArray(google?.grantedScopes)
      ? google.grantedScopes.filter((s): s is string => typeof s === 'string')
      : [],
  )
}

function rowScopeHint(row: ToolPolicyRow): string {
  const required = SCOPE_REQUIREMENTS[row.id]
  if (!required) return ''
  if (!connectionLabels.value.google || connectionLabels.value.google === 'Not connected') return ''
  if (googleGrantedScopes.value.size === 0) return ''
  const hasScope = required.some(scope => googleGrantedScopes.value.has(scope))
  return hasScope ? '' : 'Reconnect required'
}

async function setRow(row: ToolPolicyRow, enabled: boolean) {
  const nextBusy = new Set(busyRows.value)
  nextBusy.add(row.id)
  busyRows.value = nextBusy
  error.value = ''
  try {
    const result = await window.kernel.call('toolPolicy.set', {
      rowId: row.id,
      enabled,
    }) as ToolPolicyResponse
    rows.value = normalizeRows(result.policy?.rows)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    const after = new Set(busyRows.value)
    after.delete(row.id)
    busyRows.value = after
  }
}

function normalizeRows(value: unknown): ToolPolicyRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is ToolPolicyRow =>
      row &&
      typeof row === 'object' &&
      typeof (row as ToolPolicyRow).id === 'string' &&
      typeof (row as ToolPolicyRow).domain === 'string' &&
      typeof (row as ToolPolicyRow).label === 'string' &&
      Array.isArray((row as ToolPolicyRow).toolIds)
    )
    : []
}

function groupTitle(domain: ToolDomain): string {
  const label = DOMAIN_LABELS[domain]
  const state = domain === 'slack' || domain === 'google' ? connectionLabels.value[domain] : ''
  return state ? `${label} · ${state}` : label
}

function rowDetail(row: ToolPolicyRow): string {
  return row.toolIds.join(', ')
}

function searchableText(row: ToolPolicyRow): string {
  return [
    row.domain,
    row.label,
    row.description,
    ...row.toolIds,
    ...(row.aiToolKeys ?? []),
    ...(row.mcpToolNames ?? []),
  ].filter(Boolean).join(' ').toLowerCase()
}
</script>

<template>
  <section class="space-y-5 font-sans" aria-label="Tools settings">
    <div class="space-y-2">
      <input
        v-model="query"
        type="search"
        class="h-8 w-full rounded-[5px] border border-rule-light bg-chrome-high px-2.5 text-[12px] text-ink outline-none focus-visible:border-accent"
        placeholder="Search tools..."
        aria-label="Search tools"
      />
      <p class="m-0 text-[10px] text-ink-3">
        Enabled means agents may use the tool. Approval mode still decides whether Mim asks first.
      </p>
      <p v-if="error" class="m-0 text-[10px] text-rem">{{ error }}</p>
    </div>

    <p v-if="loading" class="m-0 text-[11px] text-ink-3">Loading tools...</p>

    <SettingsGroup
      v-for="group in groupedRows"
      :key="group.domain"
      :title="group.title"
    >
      <SettingRow
        v-for="row in group.rows"
        :key="row.id"
        :label="row.label"
      >
        <template #desc>
          <span class="block">{{ row.description || rowDetail(row) }}</span>
          <span v-if="row.description" class="block font-mono text-[9.5px] text-ink-4">{{ rowDetail(row) }}</span>
          <span v-if="rowScopeHint(row)" class="block text-[10px] text-rem">{{ rowScopeHint(row) }}</span>
        </template>
        <MimToggle
          :model-value="row.enabled"
          :disabled="busyRows.has(row.id) || !!rowScopeHint(row)"
          :aria-label="`${row.enabled ? 'Disable' : 'Enable'} ${row.label}`"
          :title="rowScopeHint(row) || rowDetail(row)"
          @update:model-value="setRow(row, $event)"
        />
      </SettingRow>

      <!-- Interpreter allowlist rows beneath the code domain group -->
      <template v-if="group.domain === 'code' && interpreterRows.length > 0">
        <div class="mt-2 mb-1 text-[9px] font-semibold uppercase tracking-[1.8px] text-ink-3">
          Interpreters
        </div>
        <SettingRow
          v-for="interp in interpreterRows"
          :key="'interp-' + interp.id"
          :label="interp.label"
        >
          <template #desc>
            <span :class="interp.installed ? 'block text-[10px] text-ink-3' : 'block text-[10px] text-ink-3'">
              {{ interp.versionLabel }}
            </span>
          </template>
          <MimToggle
            :model-value="interp.enabled"
            :disabled="!interp.canToggle || interpreterBusy.has(interp.id)"
            :aria-label="`${interp.enabled ? 'Disable' : 'Enable'} ${interp.label} interpreter`"
            :title="interp.canToggle ? interp.id : 'Not installed'"
            @update:model-value="toggleInterpreter(interp, $event)"
          />
        </SettingRow>
      </template>
    </SettingsGroup>

    <p v-if="!loading && groupedRows.length === 0" class="m-0 text-[11px] text-ink-3">
      No tools match the current search.
    </p>
  </section>
</template>
