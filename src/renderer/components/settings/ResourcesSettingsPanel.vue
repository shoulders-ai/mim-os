<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconAlertTriangle,
  IconCloudDownload,
  IconFolder,
  IconFolderPlus,
  IconGitBranch,
  IconLock,
  IconLockOpen,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-vue'
import { useResourcesStore, type ResourceView } from '../../stores/resources.js'

const store = useResourcesStore()

const busyId = ref<string | null>(null)
const actionError = ref<string | null>(null)
const addingFolder = ref(false)

// Pending git add.
const gitUrl = ref('')
const gitName = ref('')
const addingGit = ref(false)

const collections = computed(() => store.collections)

function statusTone(c: ResourceView): string {
  if (c.status === 'ok') return 'bg-add/10 text-add'
  if (c.status === 'not-synced') return 'bg-chrome-mid text-ink-3'
  return 'bg-rem/10 text-rem'
}

function isGit(c: ResourceView): boolean {
  return c.source?.kind === 'git_repo'
}

function basename(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

async function refresh() {
  actionError.value = null
  await store.refresh()
}

// One-step add: the picker resolves and the folder is mounted read-only
// immediately. Policy is flipped in place on the row afterwards.
async function pickAndAddFolder() {
  actionError.value = null
  const path = await store.pickFolder()
  if (!path) return
  addingFolder.value = true
  try {
    await store.addFolder({ path, name: basename(path) })
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    addingFolder.value = false
  }
}

// Satisfy a committed mim.yaml expectation: bind a local folder to its id.
async function bindCollection(c: ResourceView) {
  actionError.value = null
  const path = await store.pickFolder()
  if (!path) return
  busyId.value = c.id
  try {
    await store.addFolder({ id: c.id, path })
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    busyId.value = null
  }
}

async function toggleWrite(c: ResourceView) {
  busyId.value = c.id
  actionError.value = null
  try {
    await store.setPolicy(c.id, c.write === 'readonly' ? 'direct' : 'readonly')
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    busyId.value = null
  }
}

async function addGit() {
  const url = gitUrl.value.trim()
  if (!url) return
  addingGit.value = true
  actionError.value = null
  try {
    await store.addGit({ git: url, name: gitName.value.trim() || undefined })
    gitUrl.value = ''
    gitName.value = ''
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    addingGit.value = false
  }
}

async function syncCollection(c: ResourceView) {
  busyId.value = c.id
  actionError.value = null
  try {
    await store.sync(c.id)
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    busyId.value = null
  }
}

async function removeCollection(c: ResourceView) {
  busyId.value = c.id
  actionError.value = null
  try {
    await store.remove(c.id)
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    busyId.value = null
  }
}

function onResourcesChanged() {
  store.refresh()
}

function onWorkspaceChanged() {
  store.refresh()
}

onMounted(() => {
  store.refresh()
  window.kernel.on('resources:changed', onResourcesChanged)
  window.kernel.on('workspace:changed', onWorkspaceChanged)
})

onBeforeUnmount(() => {
  window.kernel.off('resources:changed', onResourcesChanged)
  window.kernel.off('workspace:changed', onWorkspaceChanged)
})
</script>

<template>
  <!-- Flow content only: the Settings dialog owns the header, padding, and
       scrolling (flow content; the dialog owns chrome). -->
  <section class="flex flex-col text-ink" aria-label="Resources settings">
    <header class="flex items-start justify-between gap-4">
      <p class="m-0 max-w-[400px] text-[11.5px] leading-5 text-ink-3">
        Shared folders and read-only git mirrors, mounted into the workspace
        for both you and agents.
      </p>
      <div class="flex shrink-0 items-center gap-2 pt-0.5">
        <span class="font-mono text-[10px] text-ink-3">
          {{ collections.length }} mounted
        </span>
        <button
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-45"
          :disabled="store.loading"
          title="Refresh"
          @click="refresh"
        >
          <IconRefresh :size="13" :stroke-width="2" />
        </button>
      </div>
    </header>

    <div v-if="store.error || actionError" class="mt-3 flex items-center gap-2 rounded-[6px] border border-rem/30 bg-chrome-high px-3 py-2 text-[11.5px] text-rem">
      <IconAlertTriangle class="shrink-0" :size="13" :stroke-width="2" />
      <span class="min-w-0">{{ actionError || store.error }}</span>
    </div>

    <div class="mt-4">
      <!-- Collection list -->
      <div v-if="collections.length" class="flex flex-col gap-2">
        <div
          v-for="c in collections"
          :key="c.id"
          class="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-rule-light bg-chrome-high px-3 py-2.5"
          :data-testid="`resource-row-${c.id}`"
        >
          <span class="flex h-6 w-6 items-center justify-center rounded-[6px] bg-surface text-accent">
            <IconGitBranch v-if="isGit(c)" :size="14" :stroke-width="2" />
            <IconFolder v-else :size="14" :stroke-width="2" />
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate text-[12.5px] font-medium text-ink">{{ c.name }}</span>
              <!-- Git collections are always read-only; local ones toggle in place. -->
              <span
                v-if="isGit(c)"
                class="inline-flex h-4 items-center gap-1 rounded-full px-1.5 text-[9px] font-semibold uppercase tracking-[0.03em] text-ink-3"
                title="Git collections are always read-only"
              >
                <IconLock :size="10" :stroke-width="2" />
                readonly
              </span>
              <button
                v-else
                class="inline-flex h-4 items-center gap-1 rounded-full border px-1.5 text-[9px] font-semibold uppercase tracking-[0.03em] disabled:opacity-45"
                :class="c.write === 'readonly'
                  ? 'border-rule bg-chrome-mid text-ink-3 hover:text-ink'
                  : 'border-accent/40 bg-accent-tint text-accent hover:opacity-80'"
                :data-testid="`resource-write-${c.id}`"
                :disabled="busyId === c.id"
                :title="c.write === 'readonly' ? 'Read-only — click to allow writes' : 'Writable — click to make read-only'"
                @click="toggleWrite(c)"
              >
                <IconLock v-if="c.write === 'readonly'" :size="10" :stroke-width="2" />
                <IconLockOpen v-else :size="10" :stroke-width="2" />
                {{ c.write === 'readonly' ? 'readonly' : 'writable' }}
              </button>
              <span
                class="inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-semibold"
                :class="statusTone(c)"
              >{{ c.status }}</span>
            </div>
            <code class="mt-0.5 block truncate font-mono text-[10px] text-ink-4">{{ c.mountPath }}</code>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              v-if="c.status === 'missing-binding'"
              class="flex h-7 items-center gap-1.5 rounded-[5px] border border-rule-light px-2 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-45"
              :data-testid="`resource-bind-${c.id}`"
              :disabled="busyId === c.id"
              title="This collection is declared in mim.yaml — choose the folder for it on this machine"
              @click="bindCollection(c)"
            >
              <IconFolder :size="13" :stroke-width="2" />
              <span>Choose folder…</span>
            </button>
            <button
              v-if="isGit(c)"
              class="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-45"
              :data-testid="`resource-sync-${c.id}`"
              :disabled="busyId === c.id"
              title="Sync from origin"
              @click="syncCollection(c)"
            >
              <IconCloudDownload :size="14" :stroke-width="2" />
            </button>
            <button
              class="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-rem/10 hover:text-rem disabled:opacity-45"
              :data-testid="`resource-remove-${c.id}`"
              :disabled="busyId === c.id"
              title="Remove collection (keeps the source folder)"
              @click="removeCollection(c)"
            >
              <IconTrash :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
      <div v-else class="rounded-[8px] border border-dashed border-rule-light px-4 py-8 text-center text-[11.5px] text-ink-4">
        No shared resources yet. Mount a folder or git repository below.
      </div>

      <!-- Add a local folder (one step: picked folders mount read-only) -->
      <div class="mt-6 rounded-[8px] border border-rule-light p-3">
        <div class="mb-2 flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          <IconFolderPlus :size="13" :stroke-width="2" />
          <span>Add a folder</span>
        </div>
        <button
          class="flex h-8 items-center gap-2 rounded-[5px] border border-rule-light bg-chrome-high px-3 text-[11.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-45"
          data-testid="resource-pick-folder"
          :disabled="addingFolder"
          @click="pickAndAddFolder"
        >
          <IconFolder :size="13" :stroke-width="2" />
          <span>{{ addingFolder ? 'Adding…' : 'Choose folder…' }}</span>
        </button>
        <p class="mt-2 text-[10px] text-ink-4">Folders mount read-only. Click a collection's badge to make it writable.</p>
      </div>

      <!-- Add a git repository -->
      <div class="mt-3 rounded-[8px] border border-rule-light p-3">
        <div class="mb-2 flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          <IconGitBranch :size="13" :stroke-width="2" />
          <span>Add a git repository (read-only mirror)</span>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <input
            v-model="gitUrl"
            class="h-7 min-w-[160px] flex-[2] rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
            data-testid="resource-git-url"
            placeholder="https://github.com/org/repo.git"
            @keydown.enter="addGit"
          />
          <input
            v-model="gitName"
            class="h-7 min-w-[100px] flex-1 rounded-[5px] border border-rule-light bg-surface px-2 text-[11.5px] text-ink outline-none focus:border-accent"
            placeholder="Display name"
            @keydown.enter="addGit"
          />
          <button
            class="h-7 rounded-[5px] bg-accent px-3 text-[11.5px] font-medium text-accent-ink hover:opacity-85 disabled:opacity-45"
            data-testid="resource-add-git"
            :disabled="addingGit || !gitUrl.trim()"
            @click="addGit"
          >Add</button>
        </div>
        <p class="mt-2 text-[10px] text-ink-4">Mirrors are cloned on this machine and synced with pull. Run sync to fetch updates.</p>
      </div>
    </div>
  </section>
</template>
