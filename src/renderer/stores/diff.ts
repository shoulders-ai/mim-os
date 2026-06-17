import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type DiffReviewMode = 'single' | 'batch'
export type DiffReviewSource = 'inline-ai' | 'batch' | 'approval'
export type DiffViewMode = 'original' | 'diff' | 'result'
export type DiffLayout = 'unified' | 'split'
export type DiffFileStatus = 'pending' | 'accepted' | 'rejected' | 'conflict'

export interface DiffReviewMeta {
  type?: string
  [key: string]: unknown
}

export interface DiffFileEntry {
  path: string
  original: string
  modified: string
  reviewId?: string | null
  kind?: string
  added?: number
  removed?: number
  status?: DiffFileStatus
  resolvedContent?: string
  conflictReason?: string
}

export interface ActivateDiffReviewInput {
  source: DiffReviewSource
  original: string
  modified: string
  path?: string
  reviewIds?: string[]
  batch?: string | null
  review?: DiffReviewMeta | null
  layout?: DiffLayout
}

export interface ActivateBatchDiffReviewInput {
  source?: DiffReviewSource
  fileList: DiffFileEntry[]
  batch?: string | null
  review?: DiffReviewMeta | null
  layout?: DiffLayout
}

export const useDiffStore = defineStore('diff', () => {
  const active = ref(false)
  const mode = ref<DiffReviewMode>('single')
  const source = ref<DiffReviewSource>('inline-ai')

  const originalContent = ref('')
  const modifiedContent = ref('')
  const resolvedContent = ref<string | null>(null)
  const filePath = ref('')
  const reviewIds = ref<string[]>([])
  const batchId = ref<string | null>(null)
  const reviewMeta = ref<DiffReviewMeta | null>(null)

  const files = ref<DiffFileEntry[]>([])
  const focusedFile = ref<string | null>(null)

  const viewMode = ref<DiffViewMode>('diff')
  const layout = ref<DiffLayout>('unified')
  const chunkCount = ref(0)
  const currentChunk = ref(0)

  const hasChunks = computed(() => chunkCount.value > 0)
  const isBatch = computed(() => mode.value === 'batch')
  const isBatchFileFocused = computed(() => isBatch.value && focusedFile.value !== null)
  const pendingFiles = computed(() => files.value.filter(file => file.status === 'pending'))
  const resolvedCount = computed(() => files.value.filter(file => file.status !== 'pending').length)
  const allResolved = computed(() => files.value.length > 0 && pendingFiles.value.length === 0)
  const effectiveContent = computed(() => resolvedContent.value ?? modifiedContent.value)

  function activate(input: ActivateDiffReviewInput): void {
    mode.value = 'single'
    source.value = input.source
    originalContent.value = input.original
    modifiedContent.value = input.modified
    resolvedContent.value = input.modified
    filePath.value = input.path ?? ''
    reviewIds.value = input.reviewIds ?? []
    batchId.value = input.batch ?? null
    reviewMeta.value = input.review ?? null
    files.value = []
    focusedFile.value = null
    viewMode.value = 'diff'
    layout.value = input.layout ?? 'unified'
    chunkCount.value = 0
    currentChunk.value = 0
    active.value = true
  }

  function activateBatch(input: ActivateBatchDiffReviewInput): void {
    mode.value = 'batch'
    source.value = input.source ?? 'batch'
    files.value = input.fileList.map(file => ({
      ...file,
      reviewId: file.reviewId ?? null,
      status: file.status ?? 'pending',
      resolvedContent: file.resolvedContent ?? file.modified,
    }))
    batchId.value = input.batch ?? null
    reviewMeta.value = input.review ?? null
    originalContent.value = ''
    modifiedContent.value = ''
    resolvedContent.value = null
    filePath.value = ''
    reviewIds.value = []
    focusedFile.value = null
    viewMode.value = 'diff'
    layout.value = input.layout ?? 'unified'
    chunkCount.value = 0
    currentChunk.value = 0
    active.value = true
  }

  function deactivate(): void {
    active.value = false
    mode.value = 'single'
    source.value = 'inline-ai'
    originalContent.value = ''
    modifiedContent.value = ''
    resolvedContent.value = null
    filePath.value = ''
    reviewIds.value = []
    batchId.value = null
    reviewMeta.value = null
    focusedFile.value = null
    files.value = []
    chunkCount.value = 0
    currentChunk.value = 0
  }

  function setResolvedContent(content: string): void {
    resolvedContent.value = content
    if (!focusedFile.value) return
    const file = files.value.find(item => item.path === focusedFile.value)
    if (file) file.resolvedContent = content
  }

  function acceptFile(path: string): void {
    const file = files.value.find(item => item.path === path)
    if (file) file.status = 'accepted'
  }

  function rejectFile(path: string): void {
    const file = files.value.find(item => item.path === path)
    if (file) file.status = 'rejected'
  }

  function conflictFile(path: string, reason?: string): void {
    const file = files.value.find(item => item.path === path)
    if (!file) return
    file.status = 'conflict'
    file.conflictReason = reason
  }

  function acceptAllFiles(): void {
    for (const file of files.value) file.status = 'accepted'
  }

  function rejectAllFiles(): void {
    for (const file of files.value) file.status = 'rejected'
  }

  function resetFile(path: string): void {
    const file = files.value.find(item => item.path === path)
    if (file) file.status = 'pending'
  }

  function focusBatchFile(path: string): boolean {
    const file = files.value.find(item => item.path === path)
    if (!file) {
      clearBatchFocus()
      return false
    }

    originalContent.value = file.original
    modifiedContent.value = file.modified
    resolvedContent.value = file.resolvedContent ?? file.modified
    filePath.value = file.path
    reviewIds.value = file.reviewId ? [file.reviewId] : []
    focusedFile.value = file.path
    viewMode.value = 'diff'
    chunkCount.value = 0
    currentChunk.value = 0
    return true
  }

  function clearBatchFocus(): void {
    originalContent.value = ''
    modifiedContent.value = ''
    resolvedContent.value = null
    filePath.value = ''
    reviewIds.value = []
    focusedFile.value = null
    chunkCount.value = 0
    currentChunk.value = 0
  }

  function setViewMode(nextMode: DiffViewMode): void {
    if (nextMode === 'original' || nextMode === 'diff' || nextMode === 'result') {
      viewMode.value = nextMode
    }
  }

  function setLayout(nextLayout: DiffLayout): void {
    if (nextLayout === 'unified' || nextLayout === 'split') {
      layout.value = nextLayout
    }
  }

  function setChunkCount(count: number): void {
    chunkCount.value = Math.max(0, Math.floor(count))
    if (currentChunk.value >= chunkCount.value) {
      currentChunk.value = Math.max(0, chunkCount.value - 1)
    }
  }

  function nextChunk(): void {
    if (chunkCount.value === 0) return
    currentChunk.value = (currentChunk.value + 1) % chunkCount.value
  }

  function prevChunk(): void {
    if (chunkCount.value === 0) return
    currentChunk.value = (currentChunk.value - 1 + chunkCount.value) % chunkCount.value
  }

  return {
    active,
    mode,
    source,
    isBatch,
    originalContent,
    modifiedContent,
    resolvedContent,
    effectiveContent,
    filePath,
    reviewIds,
    batchId,
    reviewMeta,
    focusedFile,
    isBatchFileFocused,
    files,
    pendingFiles,
    resolvedCount,
    allResolved,
    viewMode,
    layout,
    chunkCount,
    currentChunk,
    hasChunks,
    activate,
    activateBatch,
    deactivate,
    setResolvedContent,
    acceptFile,
    rejectFile,
    conflictFile,
    acceptAllFiles,
    rejectAllFiles,
    resetFile,
    focusBatchFile,
    clearBatchFocus,
    setViewMode,
    setLayout,
    setChunkCount,
    nextChunk,
    prevChunk,
  }
})
