<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../../stores/settings.js'
import SettingsGroup from './SettingsGroup.vue'

const settings = useSettingsStore()

// ── App info ──

interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

const appInfo = ref<AppInfo | null>(null)
const workspacePath = ref<string | null>(null)

const identity = computed(() => {
  const parts = [settings.configUserName, settings.configUserEmail].filter(Boolean)
  return parts.join(' · ')
})

const rows = computed(() => {
  const list: { label: string; value: string; mono?: boolean }[] = []
  if (workspacePath.value) list.push({ label: 'Workspace', value: workspacePath.value, mono: true })
  list.push({ label: 'Config', value: '~/.mim', mono: true })
  if (identity.value) list.push({ label: 'You', value: identity.value })
  if (settings.configTimezone) list.push({ label: 'Timezone', value: settings.configTimezone })
  return list
})

// ── Organisation registry ──

const accountToken = ref('')
const accountSaving = ref(false)
const accountStatus = ref<{
  connected: boolean
  client?: { id: string; name: string }
  entitlements?: string[]
} | null>(null)
const accountError = ref('')
const showAccountToken = ref(false)

async function refreshAccountStatus() {
  try {
    const s = await window.kernel.call('account.status') as { connected: boolean }
    if (!s?.connected) {
      accountStatus.value = { connected: false }
      return
    }
    const validation = await window.kernel.call('account.validate') as {
      valid: boolean
      client: { id: string; name: string }
      entitlements: string[]
    }
    accountStatus.value = { connected: true, client: validation.client, entitlements: validation.entitlements }
  } catch {
    accountStatus.value = { connected: false }
  }
}

async function saveAccountToken() {
  const t = accountToken.value.trim()
  if (!t) return
  accountSaving.value = true
  accountError.value = ''
  try {
    await window.kernel.call('account.setToken', { token: t })
    const validation = await window.kernel.call('account.validate') as {
      valid: boolean
      client: { id: string; name: string }
      entitlements: string[]
    }
    accountToken.value = ''
    showAccountToken.value = false
    accountStatus.value = { connected: true, client: validation.client, entitlements: validation.entitlements }
  } catch {
    await window.kernel.call('account.clearToken')
    accountStatus.value = { connected: false }
    accountError.value = 'Invalid token'
  } finally {
    accountSaving.value = false
  }
}

async function disconnectAccount() {
  accountSaving.value = true
  try {
    await window.kernel.call('account.clearToken')
    accountStatus.value = { connected: false }
  } finally {
    accountSaving.value = false
  }
}

onMounted(async () => {
  try {
    appInfo.value = await window.kernel.call('app.info') as AppInfo
  } catch { /* headless / older main without app.info */ }
  workspacePath.value = await window.kernel.getWorkspace()
  refreshAccountStatus()
  window.kernel.on('account:changed', refreshAccountStatus)
})

onUnmounted(() => {
  window.kernel.off('account:changed', refreshAccountStatus)
})
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="About">
    <div class="flex flex-col items-center pt-2 text-center">
      <span class="font-brand text-[22px] text-ink">Mim</span>
      <span class="mt-1 font-mono text-[10px] text-ink-3">{{ appInfo ? `v${appInfo.version}` : '' }}</span>

      <div class="mt-6 w-full max-w-[320px] border-t border-rule-light pt-2">
        <div
          v-for="row in rows"
          :key="row.label"
          class="flex items-center justify-between gap-4 border-b border-rule-light py-2 last:border-b-0"
        >
          <span class="shrink-0 font-sans text-[11px] text-ink-3">{{ row.label }}</span>
          <span
            class="min-w-0 truncate text-[10.5px] text-ink-2"
            :class="row.mono ? 'font-mono' : 'font-sans'"
            :title="row.value"
          >{{ row.value }}</span>
        </div>
      </div>
    </div>

    <SettingsGroup title="Organisation registry">
      <p class="m-0 pb-3 text-[11px] leading-relaxed text-ink-3">
        Paste an access token to connect to your organisation's private app registry.
      </p>

      <div
        v-if="accountStatus?.connected"
        class="overflow-hidden rounded-[8px] border border-rule-light bg-surface"
      >
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-[7px] w-[7px] shrink-0 rounded-full bg-add" />
            <span class="text-[12px] font-medium text-ink">
              {{ accountStatus.client?.name ? `Connected as ${accountStatus.client.name}` : 'Connected' }}
            </span>
          </div>
          <button
            type="button"
            class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:border-rem/40 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
            :disabled="accountSaving"
            @click="disconnectAccount"
          >Disconnect</button>
        </div>

        <div
          v-if="accountStatus.entitlements?.length"
          class="border-t border-rule-light px-3 py-2"
        >
          <span class="text-[10px] font-medium uppercase tracking-wider text-ink-3">Entitled apps</span>
          <ul class="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
            <li
              v-for="pkg in accountStatus.entitlements"
              :key="pkg"
              class="rounded-[4px] bg-chrome-mid px-1.5 py-px font-mono text-[10px] text-ink-2"
            >{{ pkg }}</li>
          </ul>
        </div>
      </div>

      <div
        v-else
        class="overflow-hidden rounded-[8px] border border-rule-light bg-surface"
      >
        <div class="px-3 py-2.5">
          <div class="flex items-center gap-2">
            <span class="h-[7px] w-[7px] shrink-0 rounded-full bg-ink-4" />
            <span class="text-[12px] text-ink-3">Not connected</span>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <input
              v-model="accountToken"
              :type="showAccountToken ? 'text' : 'password'"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="mim_tok_..."
              aria-label="Account token"
              @keydown.enter="saveAccountToken"
            />
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-40"
              :disabled="!accountToken.trim() || accountSaving"
              @click="saveAccountToken"
            >{{ accountSaving ? '...' : 'Save' }}</button>
          </div>
        </div>
      </div>

      <p
        v-if="accountError"
        class="m-0 pt-2 text-[10px] text-rem"
      >{{ accountError }}</p>
    </SettingsGroup>

    <span class="text-center font-sans text-[10px] text-ink-4">&copy; 2026</span>
  </section>
</template>
