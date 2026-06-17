<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { defaultOpenLabelForPath, fileKindForPath } from '../../services/fileOpenPolicy.js'
import { baseName, formatSize, formatTime, isFsEntry, parentDir } from './fileDisplay.js'
import type { FsEntry } from './fileTypes.js'

const props = defineProps<{
  path: string
}>()

const entry = ref<FsEntry | null>(null)
const imageDataUrl = ref<string | null>(null)
const loadError = ref('')
const copied = ref(false)
let loadToken = 0

const name = computed(() => baseName(props.path))
const kind = computed(() => fileKindForPath(props.path))
const openLabel = computed(() => {
  const label = defaultOpenLabelForPath(props.path)
  return label === 'Open in Artifact' || label === 'Open' ? 'Open in default app' : label
})
const isImage = computed(() => kind.value === 'Image')

watch(() => props.path, load, { immediate: true })

async function load() {
  const token = ++loadToken
  entry.value = null
  imageDataUrl.value = null
  loadError.value = ''
  try {
    const result = await window.kernel.call('fs.list', {
      path: parentDir(props.path),
      include_last_changed_by: true,
    }) as { entries?: unknown[] }
    if (token !== loadToken) return
    entry.value = (result.entries ?? []).filter(isFsEntry).find(item => item.path === props.path) ?? null
    if (!entry.value) loadError.value = 'File not found in workspace.'
  } catch (err) {
    if (token !== loadToken) return
    loadError.value = err instanceof Error ? err.message : String(err)
  }
  if (!isImage.value || !entry.value) return
  try {
    const image = await window.kernel.call('fs.readImageDataUrl', { path: props.path }) as { dataUrl?: string }
    if (token === loadToken) imageDataUrl.value = image.dataUrl ?? null
  } catch {
    // Preview is best-effort (oversized or unsupported image); the card still works.
  }
}

async function openNative() {
  try {
    await window.kernel.openNativeFile(props.path)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

async function reveal() {
  await window.kernel.revealInFinder(props.path)
}

async function copyPath() {
  await navigator.clipboard.writeText(props.path)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1200)
}
</script>

<template>
  <div class="flex h-full flex-col items-center overflow-y-auto bg-surface px-6 py-10 font-sans">
    <div class="w-full max-w-[440px]">
      <div class="rounded-[8px] border border-rule-light bg-chrome-high p-5">
        <div
          v-if="imageDataUrl"
          class="mb-4 flex max-h-[320px] items-center justify-center overflow-hidden rounded-[6px] border border-rule-light bg-chrome"
        >
          <img :src="imageDataUrl" :alt="name" class="max-h-[320px] max-w-full object-contain">
        </div>

        <div class="flex items-start gap-3">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] border border-rule-light bg-chrome text-[10px] font-semibold uppercase tracking-wide text-ink-3">
            {{ kind.slice(0, 4) }}
          </div>
          <div class="min-w-0">
            <h2 class="m-0 truncate text-[14px] font-semibold text-ink" :title="name">{{ name }}</h2>
            <p class="m-0 mt-0.5 truncate text-[12px] text-ink-3" :title="path">{{ path }}</p>
          </div>
        </div>

        <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
          <dt class="text-ink-4">Kind</dt>
          <dd class="m-0 text-ink-2">{{ kind }}</dd>
          <template v-if="entry">
            <dt class="text-ink-4">Size</dt>
            <dd class="m-0 text-ink-2">{{ formatSize(entry.size, entry.type) }}</dd>
            <dt class="text-ink-4">Modified</dt>
            <dd class="m-0 text-ink-2">{{ formatTime(entry.modifiedAt) }}</dd>
            <dt class="text-ink-4">Created</dt>
            <dd class="m-0 text-ink-2">{{ formatTime(entry.createdAt) }}</dd>
            <template v-if="entry.lastChangedBy">
              <dt class="text-ink-4">Last changed by</dt>
              <dd class="m-0 text-ink-2">{{ entry.lastChangedBy }}</dd>
            </template>
          </template>
        </dl>

        <p v-if="loadError" class="m-0 mt-3 text-[12px] text-rem">{{ loadError }}</p>

        <div class="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] bg-accent px-3 text-[12px] font-medium text-accent-ink hover:opacity-90"
            @click="openNative"
          >
            {{ openLabel }}
          </button>
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
            @click="reveal"
          >
            Reveal in Finder
          </button>
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
            @click="copyPath"
          >
            {{ copied ? 'Copied' : 'Copy path' }}
          </button>
        </div>
      </div>

      <p class="m-0 mt-3 text-center text-[11px] text-ink-4">
        This file type opens outside the editor. Double-click it in Files to open it directly.
      </p>
    </div>
  </div>
</template>
