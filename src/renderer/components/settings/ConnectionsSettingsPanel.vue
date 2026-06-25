<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconExternalLink,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-vue'
import { useSettingsStore } from '../../stores/settings.js'
import MimToggle from '../ui/MimToggle.vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

const settings = useSettingsStore()

// ── Slack ──

interface SlackStatus {
  account: string
  configured: boolean
  auth?: {
    ok?: boolean
    team?: string
    team_id?: string
    user?: string
    user_id?: string
  }
}

interface SlackPolicy {
  aiEnabled: boolean
  sendEnabled: boolean
  privateChannels: boolean
  directMessages: boolean
}

const DEFAULT_POLICY: SlackPolicy = {
  aiEnabled: false,
  sendEnabled: false,
  privateChannels: false,
  directMessages: false,
}

const slackStatus = ref<SlackStatus | null>(null)
const slackPolicy = ref<SlackPolicy>({ ...DEFAULT_POLICY })
const slackLoading = ref(false)
const connectError = ref('')
const showTokenInput = ref(false)
const tokenInput = ref('')
const connecting = ref(false)

const isConnected = computed(() => slackStatus.value?.configured === true)
const teamName = computed(() => slackStatus.value?.auth?.team ?? '')
const userName = computed(() => slackStatus.value?.auth?.user ?? '')

async function loadSlackStatus() {
  slackLoading.value = true
  try {
    slackStatus.value = await window.kernel.call('slack.status', {}) as SlackStatus
  } catch {
    slackStatus.value = null
  } finally {
    slackLoading.value = false
  }
}

async function loadSlackPolicy() {
  try {
    const result = await window.kernel.call('settings.get', { key: 'connectors' }) as { value: unknown }
    const connectors = result.value
    if (connectors && typeof connectors === 'object' && !Array.isArray(connectors)) {
      const slack = (connectors as Record<string, unknown>).slack
      if (slack && typeof slack === 'object' && !Array.isArray(slack)) {
        const raw = slack as Record<string, unknown>
        slackPolicy.value = {
          aiEnabled: typeof raw.aiEnabled === 'boolean' ? raw.aiEnabled : false,
          sendEnabled: typeof raw.sendEnabled === 'boolean' ? raw.sendEnabled : false,
          privateChannels: typeof raw.privateChannels === 'boolean' ? raw.privateChannels : false,
          directMessages: typeof raw.directMessages === 'boolean' ? raw.directMessages : false,
        }
        return
      }
    }
    slackPolicy.value = { ...DEFAULT_POLICY }
  } catch {
    slackPolicy.value = { ...DEFAULT_POLICY }
  }
}

async function saveSlackPolicy() {
  try {
    const result = await window.kernel.call('settings.get', { key: 'connectors' }) as { value: unknown }
    const existing = (result.value && typeof result.value === 'object' && !Array.isArray(result.value))
      ? result.value as Record<string, unknown>
      : {}
    await window.kernel.call('settings.set', {
      key: 'connectors',
      value: { ...existing, slack: { ...slackPolicy.value } },
    })
  } catch {
    // Policy save failed silently — toggles remain in the local state.
  }
}

async function updateSlackPolicy(key: keyof SlackPolicy, value: boolean) {
  slackPolicy.value[key] = value
  await saveSlackPolicy()
}

async function connectSlack() {
  const token = tokenInput.value.trim()
  if (!token) return
  connecting.value = true
  connectError.value = ''
  try {
    const result = await window.kernel.call('slack.connect', { token }) as SlackStatus
    slackStatus.value = result
    tokenInput.value = ''
    showTokenInput.value = false
  } catch (err) {
    connectError.value = err instanceof Error ? err.message : String(err)
  } finally {
    connecting.value = false
  }
}

async function disconnectSlack() {
  try {
    await window.kernel.call('slack.disconnect', {})
    slackStatus.value = { account: slackStatus.value?.account ?? 'default', configured: false }
  } catch {
    await loadSlackStatus()
  }
}

// ── Research Browser ──

interface ResearchSource {
  domain: string
  allowed: boolean
  status: 'ready' | 'needs_attention' | 'not_configured'
  attentionRequired: boolean
  lastStatus?: string
  lastSource?: string
  lastUrl?: string
  lastReadAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures?: number
  reason?: string
}

interface ResearchStatus {
  enabled: boolean
  allowedDomains: string[]
  sources: ResearchSource[]
  profile_available: boolean
}

const researchLoading = ref(false)
const researchBusy = ref('')
const researchError = ref('')
const domainInput = ref('')
const researchStatus = ref<ResearchStatus>({
  enabled: false,
  allowedDomains: [],
  sources: [],
  profile_available: false,
})

const readyCount = computed(() => researchStatus.value.sources.filter(source => source.status === 'ready').length)
const attentionCount = computed(() => researchStatus.value.sources.filter(source => source.attentionRequired).length)

async function loadResearchStatus() {
  researchLoading.value = true
  researchError.value = ''
  try {
    researchStatus.value = normalizeStatus(await window.kernel.call('web.research.status', {}) as Partial<ResearchStatus>)
  } catch (err) {
    researchError.value = err instanceof Error ? err.message : String(err)
  } finally {
    researchLoading.value = false
  }
}

async function addDomain() {
  const domain = domainInput.value.trim()
  if (!domain) return
  await runResearchAction('add', async () => {
    researchStatus.value = normalizeStatus(await window.kernel.call('web.research.allowDomain', { domain }) as Partial<ResearchStatus>)
    domainInput.value = ''
  })
}

async function removeDomain(domain: string) {
  await runResearchAction(`remove:${domain}`, async () => {
    researchStatus.value = normalizeStatus(await window.kernel.call('web.research.removeDomain', { domain }) as Partial<ResearchStatus>)
  })
}

async function allowSource(domain: string) {
  await runResearchAction(`allow:${domain}`, async () => {
    researchStatus.value = normalizeStatus(await window.kernel.call('web.research.allowDomain', { domain }) as Partial<ResearchStatus>)
  })
}

async function openSource(domain?: string) {
  await runResearchAction(`open:${domain ?? 'blank'}`, async () => {
    await window.kernel.call('web.research.open', domain ? { url: sourceSetupUrl(domain) } : {})
  })
}

async function clearProfile() {
  await runResearchAction('clear-profile', async () => {
    await window.kernel.call('web.research.clearProfile', {})
    await loadResearchStatus()
  })
}

async function runResearchAction(name: string, fn: () => Promise<void>) {
  researchBusy.value = name
  researchError.value = ''
  try {
    await fn()
  } catch (err) {
    researchError.value = err instanceof Error ? err.message : String(err)
  } finally {
    researchBusy.value = ''
  }
}

function normalizeStatus(raw: Partial<ResearchStatus>): ResearchStatus {
  return {
    enabled: raw.enabled === true,
    allowedDomains: Array.isArray(raw.allowedDomains) ? raw.allowedDomains.filter(isString) : [],
    sources: Array.isArray(raw.sources) ? raw.sources.filter(isSource) : [],
    profile_available: raw.profile_available === true,
  }
}

function isSource(value: unknown): value is ResearchSource {
  return Boolean(value && typeof value === 'object' && typeof (value as ResearchSource).domain === 'string')
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function statusLabel(source: ResearchSource): string {
  if (source.status === 'ready') return 'Ready'
  if (source.status === 'needs_attention') return 'Needs attention'
  return 'Needs setup'
}

function statusClasses(source: ResearchSource): string {
  if (source.status === 'ready') return 'border-add/30 bg-add/10 text-add'
  if (source.status === 'needs_attention') return 'border-rem/30 bg-rem/10 text-rem'
  return 'border-rule-light bg-chrome-mid text-ink-3'
}

function sourceSetupUrl(domain: string): string {
  const clean = domain.replace(/^\*\./, '')
  return `https://${clean}`
}

function formatDate(value?: string): string {
  if (!value) return ''
  return value.replace('T', ' ').slice(0, 16)
}

// ── Search keys ──

const searchProviders = [
  { id: 'exa', label: 'Exa Search', placeholder: 'exa-...', envVar: 'EXA_API_KEY', hint: 'Free key at dashboard.exa.ai' },
]

const keyInputs = ref<Record<string, string>>({})
const keySaving = ref<string | null>(null)
const keySaved = ref<string | null>(null)
const keyEditing = ref<Set<string>>(new Set())

function keyStatusFor(provider: string) {
  return settings.keyStatuses.find(s => s.provider === provider)
}

function keyInputVisible(provider: string): boolean {
  const status = keyStatusFor(provider)
  if (!status?.configured) return true
  return status.source === 'file' && keyEditing.value.has(provider)
}

function startKeyReplace(provider: string) {
  keyEditing.value.add(provider)
  keyEditing.value = new Set(keyEditing.value)
}

async function saveKey(provider: string) {
  const key = keyInputs.value[provider]?.trim()
  if (!key) return
  keySaving.value = provider
  try {
    await window.kernel.call('ai.setKey', { provider, key })
    keyInputs.value[provider] = ''
    keyEditing.value.delete(provider)
    keyEditing.value = new Set(keyEditing.value)
    keySaved.value = provider
    setTimeout(() => { if (keySaved.value === provider) keySaved.value = null }, 2000)
    await settings.refreshKeyStatuses()
  } finally {
    keySaving.value = null
  }
}

async function clearKey(provider: string) {
  keySaving.value = provider
  try {
    await window.kernel.call('ai.clearKey', { provider })
    keyInputs.value[provider] = ''
    keyEditing.value.delete(provider)
    keyEditing.value = new Set(keyEditing.value)
    await settings.refreshKeyStatuses()
  } finally {
    keySaving.value = null
  }
}

// ── Lifecycle ──

onMounted(async () => {
  await Promise.all([
    loadSlackStatus(),
    loadSlackPolicy(),
    loadResearchStatus(),
    settings.refreshKeyStatuses(),
  ])
})
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="Connections settings">
    <!-- Slack -->
    <SettingsGroup title="Slack">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="h-[7px] w-[7px] shrink-0 rounded-full"
              :class="isConnected ? 'bg-add' : 'bg-ink-4'"
            />
            <span class="text-[12px] font-medium text-ink">Slack</span>
            <span v-if="isConnected && teamName" class="truncate text-[10px] text-ink-3">
              {{ teamName }}<template v-if="userName"> &middot; {{ userName }}</template>
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <template v-if="slackLoading">
              <span class="text-[10px] italic text-ink-3">Checking...</span>
            </template>
            <template v-else-if="isConnected">
              <button
                type="button"
                class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                @click="showTokenInput = true"
              >Reconnect</button>
              <button
                type="button"
                class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:border-rem/40 hover:bg-rem/10 hover:text-rem"
                @click="disconnectSlack"
              >Disconnect</button>
            </template>
            <template v-else>
              <button
                v-if="!showTokenInput"
                type="button"
                class="h-6 rounded-[5px] bg-accent px-2.5 text-[10.5px] font-medium text-accent-ink hover:opacity-85"
                @click="showTokenInput = true"
              >Connect</button>
              <span v-else class="text-[10px] italic text-ink-3">Not connected</span>
            </template>
          </div>
        </div>

        <div v-if="showTokenInput" class="border-t border-rule-light px-3 py-2.5">
          <p class="m-0 mb-2 text-[10px] text-ink-3">
            Paste a Slack bot or user token. Create one at
            <span class="font-mono text-ink-2">api.slack.com/apps</span>.
          </p>
          <div class="flex items-center gap-2">
            <input
              v-model="tokenInput"
              type="password"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="xoxb-... or xoxp-..."
              aria-label="Slack token"
              @keydown.enter="connectSlack"
            />
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-40"
              :disabled="!tokenInput.trim() || connecting"
              @click="connectSlack"
            >{{ connecting ? '...' : 'Save' }}</button>
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
              @click="showTokenInput = false; tokenInput = ''; connectError = ''"
            >Cancel</button>
          </div>
          <p v-if="connectError" class="m-0 mt-1.5 text-[10px] text-rem">{{ connectError }}</p>
        </div>
      </div>

      <template v-if="isConnected">
        <SettingRow label="Allow AI to use Slack" desc="Expose Slack search, history, and channel tools to the AI agent">
          <MimToggle
            :model-value="slackPolicy.aiEnabled"
            aria-label="Allow AI to use Slack"
            @update:model-value="updateSlackPolicy('aiEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow private channels" desc="Let AI read private channels (off by default)">
          <MimToggle
            :model-value="slackPolicy.privateChannels"
            :disabled="!slackPolicy.aiEnabled"
            aria-label="Allow private channels"
            @update:model-value="updateSlackPolicy('privateChannels', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow direct messages" desc="Let AI read DMs and group messages (off by default)">
          <MimToggle
            :model-value="slackPolicy.directMessages"
            :disabled="!slackPolicy.aiEnabled"
            aria-label="Allow direct messages"
            @update:model-value="updateSlackPolicy('directMessages', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow AI to send messages" desc="High risk — AI can post Slack messages on your behalf">
          <MimToggle
            :model-value="slackPolicy.sendEnabled"
            :disabled="!slackPolicy.aiEnabled"
            aria-label="Allow AI to send Slack messages"
            @update:model-value="updateSlackPolicy('sendEnabled', $event)"
          />
        </SettingRow>
      </template>

      <p class="m-0 pt-2 text-center text-[10px] text-ink-3">
        Tokens are stored in the OS keychain
      </p>
    </SettingsGroup>

    <!-- Research Browser -->
    <SettingsGroup title="Research Browser">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="h-[7px] w-[7px] shrink-0 rounded-full"
              :class="researchStatus.profile_available ? 'bg-add' : 'bg-ink-4'"
            />
            <span class="text-[12px] font-medium text-ink">Research Browser</span>
            <span class="truncate text-[10px] text-ink-3">
              {{ researchStatus.profile_available ? 'Profile available' : 'Desktop profile unavailable' }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1.5 text-[10px] text-ink-3">
            <span>{{ readyCount }} ready</span>
            <span class="text-ink-4">/</span>
            <span>{{ attentionCount }} attention</span>
          </div>
        </div>

        <div class="border-t border-rule-light px-3 py-2.5">
          <div class="flex items-center gap-2">
            <input
              v-model="domainInput"
              type="text"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="example.com or *.example.com"
              aria-label="Research Browser domain"
              data-testid="research-domain-input"
              @keydown.enter="addDomain"
            />
            <button
              type="button"
              class="flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] bg-accent px-2.5 text-[11px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-40"
              :disabled="!domainInput.trim() || researchBusy === 'add'"
              data-testid="research-add-domain"
              @click="addDomain"
            >
              <IconPlus :size="13" :stroke-width="2" />
              Add
            </button>
            <button
              type="button"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border border-rule-light bg-surface text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
              :disabled="researchLoading"
              aria-label="Refresh Research Browser sources"
              data-testid="research-refresh"
              @click="loadResearchStatus"
            >
              <IconRefresh :size="13" :stroke-width="2" />
            </button>
          </div>
          <p v-if="researchError" class="m-0 mt-1.5 text-[10px] text-rem">{{ researchError }}</p>
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup title="Sources">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div v-if="researchLoading && !researchStatus.sources.length" class="px-3 py-6 text-center text-[11px] italic text-ink-3">
          Loading sources...
        </div>
        <div v-else-if="!researchStatus.sources.length" class="px-3 py-6 text-center text-[11px] text-ink-3">
          No sources configured
        </div>
        <div
          v-for="source in researchStatus.sources"
          :key="source.domain"
          class="border-b border-rule-light px-3 py-2.5 last:border-b-0"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <IconCircleCheck
                  v-if="source.status === 'ready'"
                  class="shrink-0 text-add"
                  :size="13"
                  :stroke-width="2"
                />
                <IconAlertTriangle
                  v-else
                  class="shrink-0"
                  :class="source.status === 'needs_attention' ? 'text-rem' : 'text-ink-3'"
                  :size="13"
                  :stroke-width="2"
                />
                <span class="truncate font-mono text-[12px] text-ink">{{ source.domain }}</span>
                <span
                  class="shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold"
                  :class="statusClasses(source)"
                >
                  {{ statusLabel(source) }}
                </span>
              </div>
              <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-3">
                <span v-if="source.lastStatus">Last: {{ source.lastStatus }}</span>
                <span v-if="source.lastReadAt">{{ formatDate(source.lastReadAt) }}</span>
                <span v-if="source.consecutiveFailures">Failures: {{ source.consecutiveFailures }}</span>
                <span v-if="source.lastUrl" class="max-w-full truncate font-mono">{{ source.lastUrl }}</span>
              </div>
              <p v-if="source.reason" class="m-0 mt-1 text-[10px] text-ink-2">
                {{ source.reason }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-if="!source.allowed"
                type="button"
                class="flex h-7 items-center gap-1.5 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
                :aria-label="`Allow ${source.domain}`"
                :data-testid="`research-allow-${source.domain}`"
                :disabled="researchBusy === `allow:${source.domain}`"
                @click="allowSource(source.domain)"
              >
                <IconPlus :size="12" :stroke-width="2" />
                Allow
              </button>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
                :aria-label="`Open ${source.domain} in Research Browser`"
                :data-testid="`research-open-${source.domain}`"
                :disabled="researchBusy === `open:${source.domain}`"
                @click="openSource(source.domain)"
              >
                <IconExternalLink :size="13" :stroke-width="2" />
              </button>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
                :aria-label="`Remove ${source.domain}`"
                :data-testid="`research-remove-${source.domain}`"
                :disabled="researchBusy === `remove:${source.domain}`"
                @click="removeDomain(source.domain)"
              >
                <IconTrash :size="13" :stroke-width="2" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup title="Profile">
      <div class="flex items-center justify-between gap-3 rounded-[8px] border border-rule-light bg-surface px-3 py-2.5">
        <div class="min-w-0">
          <div class="text-[12px] font-medium text-ink-2">Persistent browser profile</div>
          <div class="text-[10px] text-ink-3">Cookies and site storage are shared by configured sources</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
            data-testid="research-open-profile"
            @click="openSource()"
          >Open</button>
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
            :disabled="researchBusy === 'clear-profile'"
            data-testid="research-clear-profile"
            @click="clearProfile"
          >Clear</button>
        </div>
      </div>
    </SettingsGroup>

    <!-- Search keys -->
    <SettingsGroup title="Search">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div
          v-for="prov in searchProviders"
          :key="prov.id"
          class="border-b border-rule-light px-3 py-2.5 last:border-b-0"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="h-[7px] w-[7px] shrink-0 rounded-full"
                :class="keyStatusFor(prov.id)?.configured ? 'bg-add' : 'bg-ink-4'"
              />
              <span class="text-[12px] font-medium text-ink">{{ prov.label }}</span>
              <code class="rounded-[3px] bg-chrome-mid px-1.5 py-px font-mono text-[9px] text-ink-3">{{ prov.envVar }}</code>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span v-if="keySaved === prov.id" class="text-[10px] text-add">Key saved</span>
              <template v-if="keyStatusFor(prov.id)?.configured">
                <span
                  v-if="keyStatusFor(prov.id)?.source === 'env'"
                  class="text-[10px] text-ink-3"
                  :title="`Set by ${prov.envVar} in your environment — change or remove it there`"
                >From environment</span>
                <template v-else>
                  <button
                    v-if="!keyEditing.has(prov.id)"
                    type="button"
                    class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
                    :disabled="keySaving === prov.id"
                    @click="startKeyReplace(prov.id)"
                  >Replace</button>
                  <button
                    type="button"
                    class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:border-rem/40 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
                    :disabled="keySaving === prov.id"
                    @click="clearKey(prov.id)"
                  >Remove</button>
                </template>
              </template>
              <span v-else class="text-[10px] italic text-ink-3">{{ prov.hint ?? 'Not configured' }}</span>
            </div>
          </div>
          <div v-if="keyInputVisible(prov.id)" class="mt-2 flex items-center gap-2">
            <input
              v-model="keyInputs[prov.id]"
              type="password"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              :placeholder="prov.placeholder"
              :aria-label="`${prov.label} API key`"
              @keydown.enter="saveKey(prov.id)"
            />
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-40"
              :disabled="!keyInputs[prov.id]?.trim() || keySaving === prov.id"
              @click="saveKey(prov.id)"
            >{{ keySaving === prov.id ? '…' : 'Save' }}</button>
          </div>
        </div>
      </div>
      <p class="m-0 pt-2 text-center text-[10px] text-ink-3">Enables web_search for the AI agent</p>
    </SettingsGroup>
  </section>
</template>
