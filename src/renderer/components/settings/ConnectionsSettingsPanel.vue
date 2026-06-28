<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
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

// ── Google ──

interface GoogleStatus {
  account: string
  configured: boolean
  tokenConfigured?: boolean
  clientConfigured?: boolean
  auth?: {
    email?: string
    name?: string
    picture?: string
  }
  grantedScopes: string[]
}

interface GooglePolicy {
  aiEnabled: boolean
  gmailEnabled: boolean
  gmailSendEnabled: boolean
  calendarEnabled: boolean
  calendarWriteEnabled: boolean
  driveEnabled: boolean
  sheetsWriteEnabled: boolean
}

const DEFAULT_GOOGLE_POLICY: GooglePolicy = {
  aiEnabled: false,
  gmailEnabled: false,
  gmailSendEnabled: false,
  calendarEnabled: false,
  calendarWriteEnabled: false,
  driveEnabled: false,
  sheetsWriteEnabled: false,
}

const GOOGLE_SCOPES = {
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendarRead: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
  driveRead: 'https://www.googleapis.com/auth/drive.readonly',
  drive: 'https://www.googleapis.com/auth/drive',
  sheetsRead: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  sheetsWrite: 'https://www.googleapis.com/auth/spreadsheets',
}

const GOOGLE_CONNECT_CAPABILITIES = [
  'profile',
  'gmail.read',
  'gmail.send',
  'calendar.read',
  'calendar.write',
  'drive.read',
  'sheets.read',
  'sheets.write',
]

const googleStatus = ref<GoogleStatus | null>(null)
const googlePolicy = ref<GooglePolicy>({ ...DEFAULT_GOOGLE_POLICY })
const googleLoading = ref(false)
const googleConnecting = ref(false)
const googleConnectError = ref('')
const showGoogleTokenInput = ref(false)
const googleClientSaving = ref(false)
const googleClientId = ref('')
const googleClientSecret = ref('')
const googleAccessToken = ref('')
const googleRefreshToken = ref('')
const googleScope = ref('')
const googleExpiresAt = ref('')

const isGoogleConnected = computed(() => googleStatus.value?.configured === true || googleStatus.value?.tokenConfigured === true)
const isGoogleOAuthReady = computed(() => googleStatus.value?.clientConfigured === true)
const googleEmail = computed(() => googleStatus.value?.auth?.email ?? googleStatus.value?.account ?? '')
const googleName = computed(() => googleStatus.value?.auth?.name ?? '')
const googleCapabilitySummary = computed(() => {
  const labels: string[] = []
  if (hasGoogleScope([GOOGLE_SCOPES.gmailRead])) labels.push('Gmail read')
  if (hasGoogleScope([GOOGLE_SCOPES.gmailSend])) labels.push('Gmail send')
  if (hasGoogleScope([GOOGLE_SCOPES.calendarRead, GOOGLE_SCOPES.calendarWrite])) labels.push('Calendar')
  if (hasGoogleScope([GOOGLE_SCOPES.driveRead, GOOGLE_SCOPES.drive])) labels.push('Drive')
  if (hasGoogleScope([GOOGLE_SCOPES.sheetsRead, GOOGLE_SCOPES.sheetsWrite, GOOGLE_SCOPES.driveRead, GOOGLE_SCOPES.drive])) labels.push('Sheets read')
  if (hasGoogleScope([GOOGLE_SCOPES.sheetsWrite])) labels.push('Sheets write')
  return labels.length ? labels.join(', ') : 'No scopes recorded'
})

async function loadGoogleStatus() {
  googleLoading.value = true
  try {
    googleStatus.value = normalizeGoogleStatus(await window.kernel.call('google.status', {}) as Partial<GoogleStatus>)
  } catch {
    googleStatus.value = null
  } finally {
    googleLoading.value = false
  }
}

async function loadGooglePolicy() {
  try {
    const result = await window.kernel.call('settings.get', { key: 'connectors' }) as { value: unknown }
    const connectors = result.value
    if (connectors && typeof connectors === 'object' && !Array.isArray(connectors)) {
      const google = (connectors as Record<string, unknown>).google
      if (google && typeof google === 'object' && !Array.isArray(google)) {
        const raw = google as Record<string, unknown>
        googlePolicy.value = {
          aiEnabled: typeof raw.aiEnabled === 'boolean' ? raw.aiEnabled : false,
          gmailEnabled: typeof raw.gmailEnabled === 'boolean' ? raw.gmailEnabled : false,
          gmailSendEnabled: typeof raw.gmailSendEnabled === 'boolean' ? raw.gmailSendEnabled : false,
          calendarEnabled: typeof raw.calendarEnabled === 'boolean' ? raw.calendarEnabled : false,
          calendarWriteEnabled: typeof raw.calendarWriteEnabled === 'boolean' ? raw.calendarWriteEnabled : false,
          driveEnabled: typeof raw.driveEnabled === 'boolean' ? raw.driveEnabled : false,
          sheetsWriteEnabled: typeof raw.sheetsWriteEnabled === 'boolean' ? raw.sheetsWriteEnabled : false,
        }
        return
      }
    }
    googlePolicy.value = { ...DEFAULT_GOOGLE_POLICY }
  } catch {
    googlePolicy.value = { ...DEFAULT_GOOGLE_POLICY }
  }
}

async function saveGooglePolicy() {
  try {
    const result = await window.kernel.call('settings.get', { key: 'connectors' }) as { value: unknown }
    const existing = (result.value && typeof result.value === 'object' && !Array.isArray(result.value))
      ? result.value as Record<string, unknown>
      : {}
    await window.kernel.call('settings.set', {
      key: 'connectors',
      value: { ...existing, google: { ...googlePolicy.value } },
    })
  } catch {
    // Policy save failed silently — toggles remain in the local state.
  }
}

async function updateGooglePolicy(key: keyof GooglePolicy, value: boolean) {
  googlePolicy.value[key] = value
  await saveGooglePolicy()
}

async function connectGoogleOAuth() {
  if (!isGoogleOAuthReady.value) {
    googleConnectError.value = missingGoogleOAuthClientMessage()
    showGoogleTokenInput.value = true
    return
  }
  googleConnecting.value = true
  googleConnectError.value = ''
  try {
    googleStatus.value = normalizeGoogleStatus(await window.kernel.call('google.connect', {
      oauth: true,
      capabilities: GOOGLE_CONNECT_CAPABILITIES,
    }) as Partial<GoogleStatus>)
    clearGoogleTokenForm()
    showGoogleTokenInput.value = false
  } catch (err) {
    googleConnectError.value = googleConnectionErrorMessage(err)
  } finally {
    googleConnecting.value = false
  }
}

async function saveGoogleOAuthClient() {
  const clientId = googleClientId.value.trim()
  const clientSecret = googleClientSecret.value.trim()
  if (!clientId || !clientSecret) return
  googleClientSaving.value = true
  googleConnectError.value = ''
  try {
    await window.kernel.call('google.setOAuthClient', {
      client_id: clientId,
      client_secret: clientSecret,
    })
    googleClientId.value = ''
    googleClientSecret.value = ''
    await loadGoogleStatus()
  } catch (err) {
    googleConnectError.value = googleConnectionErrorMessage(err)
  } finally {
    googleClientSaving.value = false
  }
}

async function connectGoogle() {
  const accessToken = googleAccessToken.value.trim()
  if (!accessToken) return
  googleConnecting.value = true
  googleConnectError.value = ''
  try {
    const payload: Record<string, unknown> = { access_token: accessToken }
    if (googleRefreshToken.value.trim()) payload.refresh_token = googleRefreshToken.value.trim()
    if (googleScope.value.trim()) payload.scope = googleScope.value.trim()
    const expiresAt = Number(googleExpiresAt.value)
    if (Number.isFinite(expiresAt) && expiresAt > 0) payload.expires_at = expiresAt
    googleStatus.value = normalizeGoogleStatus(await window.kernel.call('google.connect', payload) as Partial<GoogleStatus>)
    clearGoogleTokenForm()
    showGoogleTokenInput.value = false
  } catch (err) {
    googleConnectError.value = googleConnectionErrorMessage(err)
  } finally {
    googleConnecting.value = false
  }
}

function clearGoogleTokenForm() {
  googleAccessToken.value = ''
  googleRefreshToken.value = ''
  googleScope.value = ''
  googleExpiresAt.value = ''
}

function clearGoogleAdvancedForm() {
  clearGoogleTokenForm()
  googleClientId.value = ''
  googleClientSecret.value = ''
}

function googleConnectionErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('Google OAuth client is not configured')
    ? missingGoogleOAuthClientMessage()
    : message.replace(/^Error invoking remote method 'kernel:call': Error: /, '')
}

function missingGoogleOAuthClientMessage(): string {
  return 'Google sign-in is not configured for this build. Add an OAuth client in Advanced or set the Google OAuth environment variables.'
}

async function disconnectGoogle() {
  try {
    await window.kernel.call('google.disconnect', {})
    googleStatus.value = {
      account: googleStatus.value?.account ?? 'default',
      configured: false,
      clientConfigured: googleStatus.value?.clientConfigured === true,
      tokenConfigured: false,
      grantedScopes: [],
    }
  } catch {
    await loadGoogleStatus()
  }
}

function normalizeGoogleStatus(raw: Partial<GoogleStatus>): GoogleStatus {
  return {
    account: typeof raw.account === 'string' ? raw.account : 'default',
    configured: raw.configured === true,
    tokenConfigured: raw.tokenConfigured === true,
    clientConfigured: raw.clientConfigured === true,
    auth: raw.auth && typeof raw.auth === 'object' ? raw.auth : undefined,
    grantedScopes: Array.isArray(raw.grantedScopes) ? raw.grantedScopes.filter(isString) : [],
  }
}

function hasGoogleScope(scopes: string[]): boolean {
  const granted = new Set(googleStatus.value?.grantedScopes ?? [])
  return scopes.some(scope => granted.has(scope))
}

function googleScopeHint(scopes: string[]): string {
  return hasGoogleScope(scopes) ? '' : 'Reconnect required'
}

// ── Website access ──

interface BrowserSessionStatus {
  enabled: boolean
  allowedDomains: string[]
  profile_available: boolean
}

const browserSessionLoading = ref(false)
const browserSessionBusy = ref('')
const browserSessionError = ref('')
const domainInput = ref('')
const browserSessionStatus = ref<BrowserSessionStatus>({
  enabled: false,
  allowedDomains: [],
  profile_available: false,
})

const grantedCount = computed(() => browserSessionStatus.value.allowedDomains.length)

async function loadBrowserSessionStatus() {
  browserSessionLoading.value = true
  browserSessionError.value = ''
  try {
    browserSessionStatus.value = normalizeStatus(await window.kernel.call('web.browser.status', {}) as Partial<BrowserSessionStatus>)
  } catch (err) {
    browserSessionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    browserSessionLoading.value = false
  }
}

async function addDomain() {
  const domain = domainInput.value.trim()
  if (!domain) return
  await runBrowserSessionAction('add', async () => {
    browserSessionStatus.value = normalizeStatus(await window.kernel.call('web.browser.allowDomain', { domain }) as Partial<BrowserSessionStatus>)
    domainInput.value = ''
  })
}

async function removeDomain(domain: string) {
  await runBrowserSessionAction(`remove:${domain}`, async () => {
    browserSessionStatus.value = normalizeStatus(await window.kernel.call('web.browser.removeDomain', { domain }) as Partial<BrowserSessionStatus>)
  })
}

async function openSource(domain?: string) {
  await runBrowserSessionAction(`open:${domain ?? 'blank'}`, async () => {
    await window.kernel.call('web.browser.open', domain ? { url: sourceSetupUrl(domain) } : {})
  })
}

async function clearProfile() {
  await runBrowserSessionAction('clear-profile', async () => {
    await window.kernel.call('web.browser.clearProfile', {})
    await loadBrowserSessionStatus()
  })
}

async function runBrowserSessionAction(name: string, fn: () => Promise<void>) {
  browserSessionBusy.value = name
  browserSessionError.value = ''
  try {
    await fn()
  } catch (err) {
    browserSessionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    browserSessionBusy.value = ''
  }
}

function normalizeStatus(raw: Partial<BrowserSessionStatus>): BrowserSessionStatus {
  return {
    enabled: raw.enabled === true,
    allowedDomains: Array.isArray(raw.allowedDomains) ? raw.allowedDomains.filter(isString) : [],
    profile_available: raw.profile_available === true,
  }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function sourceSetupUrl(domain: string): string {
  const clean = domain.replace(/^\*\./, '')
  return `https://${clean}`
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
    loadGoogleStatus(),
    loadGooglePolicy(),
    loadBrowserSessionStatus(),
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
                class="h-6 rounded-[5px] bg-accent px-2.5 text-[10.5px] font-medium text-accent-ink hover:bg-accent/90"
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
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
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

    <!-- Google -->
    <SettingsGroup title="Google">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="h-[7px] w-[7px] shrink-0 rounded-full"
              :class="isGoogleConnected ? 'bg-add' : 'bg-ink-4'"
            />
            <span class="text-[12px] font-medium text-ink">Google</span>
            <span v-if="isGoogleConnected && googleEmail" class="truncate text-[10px] text-ink-3">
              {{ googleEmail }}<template v-if="googleName"> &middot; {{ googleName }}</template>
            </span>
            <span v-else class="truncate text-[10px] text-ink-3">
              Not connected
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <template v-if="googleLoading">
              <span class="text-[10px] italic text-ink-3">Checking...</span>
            </template>
            <template v-else-if="isGoogleConnected">
              <button
                type="button"
                class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                :disabled="googleConnecting"
                data-testid="google-connect-toggle"
                @click="connectGoogleOAuth"
              >{{ googleConnecting ? 'Waiting...' : 'Reconnect' }}</button>
              <button
                type="button"
                class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                data-testid="google-advanced-toggle"
                @click="showGoogleTokenInput = !showGoogleTokenInput"
              >Advanced</button>
              <button
                type="button"
                class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:border-rem/40 hover:bg-rem/10 hover:text-rem"
                data-testid="google-disconnect"
                @click="disconnectGoogle"
              >Disconnect</button>
            </template>
            <template v-else>
              <button
                type="button"
                class="h-6 rounded-[5px] bg-accent px-2.5 text-[10.5px] font-medium text-accent-ink hover:bg-accent/90"
                :disabled="googleConnecting"
                data-testid="google-connect-toggle"
                @click="connectGoogleOAuth"
              >{{ googleConnecting ? 'Waiting...' : (isGoogleOAuthReady ? 'Sign in with Google' : 'Set up Google') }}</button>
              <button
                type="button"
                class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                data-testid="google-advanced-toggle"
                @click="showGoogleTokenInput = !showGoogleTokenInput"
              >Advanced</button>
            </template>
          </div>
        </div>

        <div v-if="isGoogleConnected" class="border-t border-rule-light px-3 py-2 text-[10px] text-ink-3">
          {{ googleCapabilitySummary }}
        </div>

        <div v-if="!googleLoading && !isGoogleOAuthReady" class="border-t border-rule-light px-3 py-2 text-[10px] text-ink-3">
          Google sign-in is not configured for this build.
        </div>

        <div v-if="googleConnectError && !showGoogleTokenInput" class="border-t border-rule-light px-3 py-2 text-[10px] text-rem">
          {{ googleConnectError }}
        </div>

        <div v-if="showGoogleTokenInput" class="border-t border-rule-light px-3 py-2.5">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-[10.5px] font-medium text-ink-2">OAuth app setup</span>
            <span class="text-[10px] text-ink-4">{{ isGoogleOAuthReady ? 'Configured' : 'Required before sign-in' }}</span>
          </div>
          <div class="grid gap-2 border-b border-rule-light pb-2">
            <input
              v-model="googleClientId"
              type="text"
              class="h-7 min-w-0 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="OAuth client ID"
              aria-label="Google OAuth client ID"
              data-testid="google-client-id"
              @keydown.enter="saveGoogleOAuthClient"
            />
            <input
              v-model="googleClientSecret"
              type="password"
              class="h-7 min-w-0 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="OAuth client secret"
              aria-label="Google OAuth client secret"
              data-testid="google-client-secret"
              @keydown.enter="saveGoogleOAuthClient"
            />
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="h-7 shrink-0 rounded-[5px] border border-rule-light bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
                :disabled="!googleClientId.trim() || !googleClientSecret.trim() || googleClientSaving"
                data-testid="google-save-client"
                @click="saveGoogleOAuthClient"
              >{{ googleClientSaving ? '...' : 'Save OAuth App' }}</button>
            </div>
          </div>

          <div class="mt-2 mb-2 flex items-center justify-between gap-2">
            <span class="text-[10.5px] font-medium text-ink-2">Manual token setup</span>
            <span class="text-[10px] text-ink-4">For development and recovery</span>
          </div>
          <div class="grid gap-2">
            <input
              v-model="googleAccessToken"
              type="password"
              class="h-7 min-w-0 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="Access token"
              aria-label="Google access token"
              data-testid="google-access-token"
              @keydown.enter="connectGoogle"
            />
            <input
              v-model="googleRefreshToken"
              type="password"
              class="h-7 min-w-0 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="Refresh token (optional)"
              aria-label="Google refresh token"
              @keydown.enter="connectGoogle"
            />
            <input
              v-model="googleScope"
              type="text"
              class="h-7 min-w-0 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="Scopes"
              aria-label="Google scopes"
              data-testid="google-scope"
              @keydown.enter="connectGoogle"
            />
            <input
              v-model="googleExpiresAt"
              type="number"
              class="h-7 min-w-0 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="Expires at Unix ms (optional)"
              aria-label="Google token expiration"
              @keydown.enter="connectGoogle"
            />
          </div>
          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
              :disabled="!googleAccessToken.trim() || googleConnecting"
              data-testid="google-save-token"
              @click="connectGoogle"
            >{{ googleConnecting ? '...' : 'Save' }}</button>
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
              @click="showGoogleTokenInput = false; clearGoogleAdvancedForm(); googleConnectError = ''"
            >Cancel</button>
          </div>
          <p v-if="googleConnectError" class="m-0 mt-1.5 text-[10px] text-rem">{{ googleConnectError }}</p>
        </div>
      </div>

      <template v-if="isGoogleConnected">
        <SettingRow label="Allow AI to use Google" desc="Expose configured Google read tools to the AI agent">
          <MimToggle
            :model-value="googlePolicy.aiEnabled"
            aria-label="Allow AI to use Google"
            @update:model-value="updateGooglePolicy('aiEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow Gmail" :desc="googleScopeHint([GOOGLE_SCOPES.gmailRead]) || 'Let AI search and read Gmail'">
          <MimToggle
            :model-value="googlePolicy.gmailEnabled"
            :disabled="!googlePolicy.aiEnabled || !hasGoogleScope([GOOGLE_SCOPES.gmailRead])"
            aria-label="Allow Gmail"
            @update:model-value="updateGooglePolicy('gmailEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow AI to send Gmail" :desc="googleScopeHint([GOOGLE_SCOPES.gmailSend]) || 'High risk - AI can send email on your behalf'">
          <MimToggle
            :model-value="googlePolicy.gmailSendEnabled"
            :disabled="!googlePolicy.aiEnabled || !googlePolicy.gmailEnabled || !hasGoogleScope([GOOGLE_SCOPES.gmailSend])"
            aria-label="Allow AI to send Gmail"
            @update:model-value="updateGooglePolicy('gmailSendEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow Calendar" :desc="googleScopeHint([GOOGLE_SCOPES.calendarRead, GOOGLE_SCOPES.calendarWrite]) || 'Let AI read calendar events'">
          <MimToggle
            :model-value="googlePolicy.calendarEnabled"
            :disabled="!googlePolicy.aiEnabled || !hasGoogleScope([GOOGLE_SCOPES.calendarRead, GOOGLE_SCOPES.calendarWrite])"
            aria-label="Allow Calendar"
            @update:model-value="updateGooglePolicy('calendarEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow AI to create events" :desc="googleScopeHint([GOOGLE_SCOPES.calendarWrite]) || 'High risk - AI can create calendar events'">
          <MimToggle
            :model-value="googlePolicy.calendarWriteEnabled"
            :disabled="!googlePolicy.aiEnabled || !googlePolicy.calendarEnabled || !hasGoogleScope([GOOGLE_SCOPES.calendarWrite])"
            aria-label="Allow AI to create events"
            @update:model-value="updateGooglePolicy('calendarWriteEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow Drive" :desc="googleScopeHint([GOOGLE_SCOPES.driveRead, GOOGLE_SCOPES.drive]) || 'Let AI search Drive and read supported files'">
          <MimToggle
            :model-value="googlePolicy.driveEnabled"
            :disabled="!googlePolicy.aiEnabled || !hasGoogleScope([GOOGLE_SCOPES.driveRead, GOOGLE_SCOPES.drive])"
            aria-label="Allow Drive"
            @update:model-value="updateGooglePolicy('driveEnabled', $event)"
          />
        </SettingRow>

        <SettingRow label="Allow AI to update Sheets" :desc="googleScopeHint([GOOGLE_SCOPES.sheetsWrite]) || 'High risk - AI can update spreadsheets'">
          <MimToggle
            :model-value="googlePolicy.sheetsWriteEnabled"
            :disabled="!googlePolicy.aiEnabled || !googlePolicy.driveEnabled || !hasGoogleScope([GOOGLE_SCOPES.sheetsWrite])"
            aria-label="Allow AI to update Sheets"
            @update:model-value="updateGooglePolicy('sheetsWriteEnabled', $event)"
          />
        </SettingRow>
      </template>
    </SettingsGroup>

    <!-- Website access -->
    <SettingsGroup title="Website Access">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="h-[7px] w-[7px] shrink-0 rounded-full"
              :class="browserSessionStatus.profile_available ? 'bg-add' : 'bg-ink-4'"
            />
            <span class="text-[12px] font-medium text-ink">Website access</span>
            <span class="truncate text-[10px] text-ink-3">
              {{ browserSessionStatus.profile_available ? 'Available' : 'Unavailable' }}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1.5 text-[10px] text-ink-3">
            <span>{{ grantedCount }} granted</span>
          </div>
        </div>

        <div class="border-t border-rule-light px-3 py-2.5">
          <div class="flex items-center gap-2">
            <input
              v-model="domainInput"
              type="text"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="example.com or *.example.com"
              aria-label="Website access domain"
              data-testid="browser-session-domain-input"
              @keydown.enter="addDomain"
            />
            <button
              type="button"
              class="flex h-7 shrink-0 items-center gap-1.5 rounded-[5px] bg-accent px-2.5 text-[11px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
              :disabled="!domainInput.trim() || browserSessionBusy === 'add'"
              data-testid="browser-session-add-domain"
              @click="addDomain"
            >
              <IconPlus :size="13" :stroke-width="2" />
              Add
            </button>
            <button
              type="button"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border border-rule-light bg-surface text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
              :disabled="browserSessionLoading"
              aria-label="Refresh website access domains"
              data-testid="browser-session-refresh"
              @click="loadBrowserSessionStatus"
            >
              <IconRefresh :size="13" :stroke-width="2" />
            </button>
          </div>
          <p v-if="browserSessionError" class="m-0 mt-1.5 text-[10px] text-rem">{{ browserSessionError }}</p>
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup title="Domains">
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div v-if="browserSessionLoading && !browserSessionStatus.allowedDomains.length" class="px-3 py-6 text-center text-[11px] italic text-ink-3">
          Loading domains...
        </div>
        <div v-else-if="!browserSessionStatus.allowedDomains.length" class="px-3 py-6 text-center text-[11px] text-ink-3">
          No domains granted
        </div>
        <div
          v-for="domain in browserSessionStatus.allowedDomains"
          :key="domain"
          class="border-b border-rule-light px-3 py-2.5 last:border-b-0"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <span class="h-[7px] w-[7px] shrink-0 rounded-full bg-add" />
                <span class="truncate font-mono text-[12px] text-ink">{{ domain }}</span>
                <span
                  class="shrink-0 rounded-full border border-add/30 bg-add/10 px-1.5 py-0.5 text-[9px] font-semibold text-add"
                >
                  Granted
                </span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
                :aria-label="`Open ${domain} for website access setup`"
                :data-testid="`browser-session-open-${domain}`"
                :disabled="browserSessionBusy === `open:${domain}`"
                @click="openSource(domain)"
              >
                <IconExternalLink :size="13" :stroke-width="2" />
              </button>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
                :aria-label="`Remove ${domain}`"
                :data-testid="`browser-session-remove-${domain}`"
                :disabled="browserSessionBusy === `remove:${domain}`"
                @click="removeDomain(domain)"
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
          <div class="text-[12px] font-medium text-ink-2">Website access data</div>
          <div class="text-[10px] text-ink-3">Sign-in, consent, and cookies are used only for granted websites</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
            data-testid="browser-session-open-profile"
            @click="openSource()"
          >Open</button>
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
            :disabled="browserSessionBusy === 'clear-profile'"
            data-testid="browser-session-clear-profile"
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
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:bg-accent/90 disabled:opacity-40"
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
