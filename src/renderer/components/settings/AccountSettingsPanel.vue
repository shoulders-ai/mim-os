<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

const token = ref('')
const saving = ref(false)
const status = ref<{
  connected: boolean
  client?: { id: string; name: string }
  entitlements?: string[]
} | null>(null)
const error = ref('')
const showToken = ref(false)

async function refreshStatus() {
  try {
    const s = await window.kernel.call('account.status') as { connected: boolean }
    if (!s?.connected) {
      status.value = { connected: false }
      return
    }
    const validation = await window.kernel.call('account.validate') as {
      valid: boolean
      client: { id: string; name: string }
      entitlements: string[]
    }
    status.value = { connected: true, client: validation.client, entitlements: validation.entitlements }
  } catch {
    status.value = { connected: false }
  }
}

async function saveToken() {
  const t = token.value.trim()
  if (!t) return
  saving.value = true
  error.value = ''
  try {
    await window.kernel.call('account.setToken', { token: t })
    const validation = await window.kernel.call('account.validate') as {
      valid: boolean
      client: { id: string; name: string }
      entitlements: string[]
    }
    token.value = ''
    showToken.value = false
    status.value = { connected: true, client: validation.client, entitlements: validation.entitlements }
  } catch (err) {
    await window.kernel.call('account.clearToken')
    status.value = { connected: false }
    error.value = 'Invalid token'
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  saving.value = true
  try {
    await window.kernel.call('account.clearToken')
    status.value = { connected: false }
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  refreshStatus()
  window.kernel.on('account:changed', refreshStatus)
})

onUnmounted(() => {
  window.kernel.off('account:changed', refreshStatus)
})
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="Account settings">
    <SettingsGroup title="Organisation registry">
      <p class="m-0 pb-3 text-[11px] leading-relaxed text-ink-3">
        Paste an access token to connect to your organisation's private app registry.
      </p>

      <!-- Connected state -->
      <div
        v-if="status?.connected"
        class="overflow-hidden rounded-[8px] border border-rule-light bg-surface"
      >
        <div class="flex items-center justify-between gap-3 px-3 py-2.5">
          <div class="flex min-w-0 items-center gap-2">
            <span class="h-[7px] w-[7px] shrink-0 rounded-full bg-add" />
            <span class="text-[12px] font-medium text-ink">
              {{ status.client?.name ? `Connected as ${status.client.name}` : 'Connected' }}
            </span>
          </div>
          <button
            type="button"
            class="h-6 rounded-[5px] border border-rule-light bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:border-rem/40 hover:bg-rem/10 hover:text-rem disabled:opacity-40"
            :disabled="saving"
            @click="disconnect"
          >Disconnect</button>
        </div>

        <!-- Entitlements -->
        <div
          v-if="status.entitlements?.length"
          class="border-t border-rule-light px-3 py-2"
        >
          <span class="text-[10px] font-medium uppercase tracking-wider text-ink-3">Entitled apps</span>
          <ul class="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
            <li
              v-for="pkg in status.entitlements"
              :key="pkg"
              class="rounded-[4px] bg-chrome-mid px-1.5 py-px font-mono text-[10px] text-ink-2"
            >{{ pkg }}</li>
          </ul>
        </div>
      </div>

      <!-- Disconnected state -->
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
              v-model="token"
              :type="showToken ? 'text' : 'password'"
              class="h-7 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 font-mono text-[11px] text-ink-2 outline-none transition-colors duration-100 focus:border-accent"
              placeholder="mim_tok_..."
              aria-label="Account token"
              @keydown.enter="saveToken"
            />
            <button
              type="button"
              class="h-7 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-40"
              :disabled="!token.trim() || saving"
              @click="saveToken"
            >{{ saving ? '...' : 'Save' }}</button>
          </div>
        </div>
      </div>

      <!-- Error -->
      <p
        v-if="error"
        class="m-0 pt-2 text-[10px] text-rem"
      >{{ error }}</p>
    </SettingsGroup>
  </section>
</template>
