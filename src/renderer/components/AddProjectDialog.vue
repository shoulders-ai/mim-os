<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import MimDialog from './ui/MimDialog.vue'

const props = defineProps<{
  mode: 'new' | 'clone'
}>()

const emit = defineEmits<{
  close: []
  created: [path: string]
}>()

// ---- New Folder state ----
const parentPath = ref('')
const newFolderName = ref('')
const newFolderInputRef = ref<HTMLInputElement | null>(null)

// ---- Clone Repo state ----
const cloneUrl = ref('')
const cloneParentPath = ref('')
const cloneFolderName = ref('')
const cloneToken = ref('')
const cloneUrlInputRef = ref<HTMLInputElement | null>(null)

// Auto-populate folder name from clone URL
watch(cloneUrl, (url) => {
  if (!url) return
  const match = url.match(/\/([^\/]+?)(?:\.git)?$/)
  if (match) cloneFolderName.value = match[1]
})

const errorMessage = ref('')
const creating = ref(false)

const dialogTitle = computed(() =>
  props.mode === 'clone' ? 'Clone Repository' : 'New Folder'
)

const canCreate = computed(() => {
  if (props.mode === 'new') {
    return Boolean(parentPath.value && newFolderName.value.trim())
  }
  return Boolean(
    cloneUrl.value.trim() &&
    cloneParentPath.value &&
    cloneFolderName.value.trim()
  )
})

const createLabel = computed(() => {
  if (creating.value) {
    return props.mode === 'clone' ? 'Cloning...' : 'Creating...'
  }
  return props.mode === 'clone' ? 'Clone Repository' : 'Create Folder'
})

const initialFocusRef = computed(() =>
  props.mode === 'clone' ? cloneUrlInputRef : newFolderInputRef,
)

async function pickParent() {
  try {
    const selected = await window.kernel.openFolderDialog()
    if (!selected) return
    parentPath.value = selected
    errorMessage.value = ''
  } catch (e) {
    errorMessage.value = String(e)
  }
}

async function pickCloneParent() {
  try {
    const selected = await window.kernel.openFolderDialog()
    if (!selected) return
    cloneParentPath.value = selected
    errorMessage.value = ''
  } catch (e) {
    errorMessage.value = String(e)
  }
}

async function create() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  errorMessage.value = ''

  try {
    if (props.mode === 'new') {
      const fullPath = `${parentPath.value}/${newFolderName.value.trim()}`
      await window.kernel.createDirectory(fullPath)
      emit('created', fullPath)
      emit('close')
    } else {
      const fullPath = `${cloneParentPath.value}/${cloneFolderName.value.trim()}`
      const token = cloneToken.value.trim() || undefined
      await window.kernel.gitClone(cloneUrl.value.trim(), fullPath, token)
      emit('created', fullPath)
      emit('close')
    }
  } catch (e: unknown) {
    errorMessage.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

</script>

<template>
  <MimDialog
    :aria-label="dialogTitle"
    size="sm"
    panel-class="rounded-[10px]"
    :initial-focus="initialFocusRef"
    @close="$emit('close')"
  >

        <!-- Header -->
        <div class="flex items-center justify-between px-4 pt-[14px]">
          <span class="font-sans text-[13px] font-semibold text-ink">{{ dialogTitle }}</span>
          <button
            class="w-[26px] h-[26px] flex items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
            @click="$emit('close')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Body -->
        <div class="p-4 flex flex-col gap-3">

          <!-- New Folder mode -->
          <template v-if="mode === 'new'">
            <div class="flex flex-col gap-1">
              <label class="font-sans text-[11px] font-medium text-ink-3">Parent directory</label>
              <div class="flex items-center gap-2">
                <span
                  class="flex-1 font-mono text-[11px] bg-surface border border-rule-light rounded-[6px] px-[10px] min-h-[30px] flex items-center overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:ltr]"
                  :class="parentPath ? 'text-ink-2' : 'text-ink-4 italic'"
                  :title="parentPath || undefined"
                >
                  {{ parentPath || 'No directory selected' }}
                </span>
                <button
                  class="font-sans text-[11px] font-medium text-ink-2 border border-rule rounded-[6px] px-[10px] h-[30px] whitespace-nowrap shrink-0 hover:bg-chrome-high hover:text-ink"
                  @click="pickParent"
                >Browse</button>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label class="font-sans text-[11px] font-medium text-ink-3">Folder name</label>
              <input
                ref="newFolderInputRef"
                v-model="newFolderName"
                class="apd-input w-full font-mono text-[12px] text-ink bg-surface border border-rule-light rounded-[6px] px-[10px] h-[30px] outline-none focus:border-accent placeholder:text-ink-4 text-left [direction:ltr]"
                placeholder="my-research-paper"
                autocorrect="off"
                autocapitalize="off"
                @keydown.enter="create"
              />
            </div>
          </template>

          <!-- Clone Repository mode -->
          <template v-else>
            <div class="flex flex-col gap-1">
              <label class="font-sans text-[11px] font-medium text-ink-3">Repository URL</label>
              <input
                ref="cloneUrlInputRef"
                v-model="cloneUrl"
                class="apd-input w-full font-mono text-[12px] text-ink bg-surface border border-rule-light rounded-[6px] px-[10px] h-[30px] outline-none focus:border-accent placeholder:text-ink-4"
                placeholder="https://github.com/user/repo.git"
                autocorrect="off"
                autocapitalize="off"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="font-sans text-[11px] font-medium text-ink-3">Clone into</label>
              <div class="flex items-center gap-2">
                <span
                  class="flex-1 font-mono text-[11px] bg-surface border border-rule-light rounded-[6px] px-[10px] min-h-[30px] flex items-center overflow-hidden text-ellipsis whitespace-nowrap text-left [direction:ltr]"
                  :class="cloneParentPath ? 'text-ink-2' : 'text-ink-4 italic'"
                  :title="cloneParentPath || undefined"
                >
                  {{ cloneParentPath || 'Select parent directory' }}
                </span>
                <button
                  class="font-sans text-[11px] font-medium text-ink-2 border border-rule rounded-[6px] px-[10px] h-[30px] whitespace-nowrap shrink-0 hover:bg-chrome-high hover:text-ink"
                  @click="pickCloneParent"
                >Browse</button>
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label class="font-sans text-[11px] font-medium text-ink-3">Folder name</label>
              <input
                v-model="cloneFolderName"
                class="apd-input w-full font-mono text-[12px] text-ink bg-surface border border-rule-light rounded-[6px] px-[10px] h-[30px] outline-none focus:border-accent placeholder:text-ink-4 text-left [direction:ltr]"
                placeholder="repo-name"
                autocorrect="off"
                autocapitalize="off"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="font-sans text-[11px] font-medium text-ink-3">
                Access token
                <span class="font-normal text-ink-4">(optional, for private repos)</span>
              </label>
              <input
                v-model="cloneToken"
                type="password"
                class="apd-input w-full font-mono text-[12px] text-ink bg-surface border border-rule-light rounded-[6px] px-[10px] h-[30px] outline-none focus:border-accent placeholder:text-ink-4"
                placeholder="ghp_..."
                @keydown.enter="create"
              />
            </div>
          </template>

          <p v-if="errorMessage" class="font-sans text-[11px] text-rem m-0 pt-1">{{ errorMessage }}</p>
        </div>

        <!-- Footer -->
        <div class="flex justify-end gap-2 px-4 pb-[14px]">
          <button
            class="font-sans text-[11px] font-medium text-ink-2 px-3 h-[30px] rounded-[6px] hover:bg-chrome-high"
            @click="$emit('close')"
          >Cancel</button>
          <button
            class="font-sans text-[11px] font-semibold text-accent-ink bg-accent px-[14px] h-[30px] rounded-[6px] flex items-center gap-1.5 hover:enabled:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
            :disabled="!canCreate || creating"
            @click="create"
          >
            <svg v-if="creating" class="apd-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            {{ createLabel }}
          </button>
        </div>

  </MimDialog>
</template>

<style>
.apd-spinner {
  animation: apd-spin 1s linear infinite;
}
@keyframes apd-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
