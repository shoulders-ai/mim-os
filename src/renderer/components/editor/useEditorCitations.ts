import { computed, nextTick, ref, watch, type ComputedRef } from 'vue'
import type { useSettingsStore } from '../../stores/settings.js'
import type { useToastStore } from '../../stores/toasts.js'
import {
  citationOccurrences,
  computeCitationHealth,
  groupDocumentCitations,
  nextCitationOccurrence,
} from '../../services/citationHealth.js'
import type { BibliographyCandidate, EditorReference, TabKind } from './editorTypes.js'

type SettingsStore = ReturnType<typeof useSettingsStore>
type ToastStore = ReturnType<typeof useToastStore>

interface UseEditorCitationsOptions {
  activePath: ComputedRef<string>
  activeMarkdown: ComputedRef<string>
  activeIsMarkdown: ComputedRef<boolean>
  settingsStore: SettingsStore
  toastStore: ToastStore
  getEditorView: () => any
  openDocument: (path: string, kind?: TabKind) => Promise<void>
}

export function useEditorCitations(options: UseEditorCitationsOptions) {
  const references = ref<EditorReference[]>([])
  const referenceLibraryActive = ref(false)
  const activeReferencePath = ref(options.settingsStore.referencesBibPath)
  const activeReferenceSource = ref('')
  const duplicateReferenceKeys = ref<Array<{ key: string; count?: number }>>([])
  const bibliographyCandidates = ref<BibliographyCandidate[]>([])
  const bibliographyPopoverOpen = ref(false)
  const showBibliographyCandidates = ref(false)
  const referencesAddAvailable = ref(false)
  let referenceLoadToken = 0

  function getReferences() { return references.value }

  const citationHealth = computed(() =>
    computeCitationHealth(
      options.activeMarkdown.value,
      references.value,
      options.activeIsMarkdown.value,
    )
  )

  function getDiagnostics() {
    return {
      enabled: options.activeIsMarkdown.value && (referenceLibraryActive.value || citationHealth.value.total > 0),
      duplicateKeys: duplicateReferenceKeys.value,
    }
  }

  const citationActions = {
    canAddCitation: () => referencesAddAvailable.value,
    addCitation: addCitationByDoi,
    openPdf: (_reference: EditorReference, pdfPath: string) => { void openReferencePdf(pdfPath) },
    onReferencesChanged: () => { void loadReferences() },
    onError: (err: unknown) => {
      options.toastStore.push({ kind: 'error', message: 'Citation action failed', detail: errorDetail(err) })
    },
  }

  const citationKeySignature = computed(() => {
    if (!options.activeIsMarkdown.value) return ''
    return [...new Set(citationOccurrences(options.activeMarkdown.value).map(item => item.key))]
      .sort((a, b) => a.localeCompare(b))
      .join('\0')
  })

  const showCitationStatus = computed(() =>
    options.activeIsMarkdown.value && citationHealth.value.total > 0
  )

  const documentCitations = computed(() =>
    options.activeIsMarkdown.value
      ? groupDocumentCitations(options.activeMarkdown.value, references.value)
      : [],
  )

  async function loadReferences(params: { includeCandidates?: boolean } = {}): Promise<void> {
    const token = ++referenceLoadToken
    try {
      const result = await window.kernel.call('references.resolveBibliography', {
        path: options.activePath.value,
        markdown: options.activeMarkdown.value,
        include_candidates: params.includeCandidates === true,
      }) as {
        path?: unknown
        exists?: unknown
        source?: unknown
        references?: unknown
        duplicateKeys?: unknown
        candidates?: unknown
      }
      if (token !== referenceLoadToken) return

      activeReferencePath.value = typeof result.path === 'string'
        ? result.path
        : options.settingsStore.referencesBibPath
      activeReferenceSource.value = typeof result.source === 'string' ? result.source : ''
      referenceLibraryActive.value = result.exists === true
      references.value = sanitizeReferenceRows(result.references)
      duplicateReferenceKeys.value = sanitizeDuplicateKeys(result.duplicateKeys)
      bibliographyCandidates.value = sanitizeBibliographyCandidates(result.candidates)
    } catch (err) {
      if (token !== referenceLoadToken) return
      activeReferencePath.value = options.settingsStore.referencesBibPath
      activeReferenceSource.value = ''
      referenceLibraryActive.value = false
      references.value = []
      duplicateReferenceKeys.value = []
      bibliographyCandidates.value = []
      console.error('Failed to load references:', err)
    } finally {
      if (token === referenceLoadToken) refreshCitationDecorations()
    }
  }

  async function loadReferenceToolAvailability(): Promise<void> {
    try {
      const result = await window.kernel.call('package.tools.list', {}) as { tools?: unknown }
      const tools = Array.isArray(result.tools) ? result.tools : []
      referencesAddAvailable.value = tools.some((item) =>
        item && typeof item === 'object' && (item as Record<string, unknown>).name === 'references.add',
      )
    } catch {
      referencesAddAvailable.value = false
    } finally {
      refreshCitationDecorations()
    }
  }

  async function addCitationByDoi(doi: string): Promise<{ key: string }> {
    if (!referencesAddAvailable.value) throw new Error('References app is not enabled')
    const result = await window.kernel.call('references.add', { doi }) as { key?: unknown }
    const key = typeof result.key === 'string' ? result.key : ''
    if (!key) throw new Error('Reference was added without a citation key')
    await loadReferences()
    return { key }
  }

  async function openReferencePdf(pdfPath: string): Promise<void> {
    const path = resolveReferencePdfPath(pdfPath)
    if (!path) {
      options.toastStore.push({ kind: 'error', message: 'PDF path is not workspace-relative' })
      return
    }
    await options.openDocument(path, 'pdf')
  }

  function resolveReferencePdfPath(pdfPath: string): string {
    const clean = pdfPath.replaceAll('\\', '/').replace(/^\/+/, '')
    if (!clean || clean.startsWith('..') || clean.includes('/../') || /^[A-Za-z]:/.test(clean)) return ''
    if (clean.startsWith('references/') || clean.startsWith('.mim/resources/')) return clean
    const bibPath = activeReferencePath.value || ''
    const slash = bibPath.lastIndexOf('/')
    const base = slash > 0 ? bibPath.slice(0, slash) : ''
    const combined = base ? `${base}/${clean}` : clean
    if (combined.startsWith('..') || combined.includes('/../')) return ''
    return combined
  }

  function refreshCitationDecorations(): void {
    nextTick(() => {
      options.getEditorView()?.dispatch({})
    })
  }

  async function toggleBibliographyPopover(): Promise<void> {
    bibliographyPopoverOpen.value = !bibliographyPopoverOpen.value
    if (bibliographyPopoverOpen.value) {
      showBibliographyCandidates.value = citationHealth.value.unresolved.length > 0
      await loadReferences({ includeCandidates: true })
    }
  }

  function closeBibliographyPopover(): void {
    bibliographyPopoverOpen.value = false
  }

  function handleBibliographyOutsidePointerDown(event: PointerEvent): void {
    if (!bibliographyPopoverOpen.value) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (target instanceof Element && target.closest('[data-testid="bibliography-popover"]')) return
    if (target instanceof Element && target.closest('[data-testid="editor-citation-status"]')) return
    closeBibliographyPopover()
  }

  async function useBibliographyCandidate(path: string): Promise<void> {
    await options.settingsStore.set('references.bibPath', path)
    closeBibliographyPopover()
    await loadReferences({ includeCandidates: true })
  }

  async function openActiveBibliography(): Promise<void> {
    if (!referenceLibraryActive.value || !activeReferencePath.value) return
    await options.openDocument(activeReferencePath.value, 'text')
    closeBibliographyPopover()
  }

  function jumpToCitation(key: string): void {
    const editorView = options.getEditorView()
    if (!editorView) return
    const head = editorView.state.selection?.main?.head ?? 0
    const target = nextCitationOccurrence(options.activeMarkdown.value, key, head)
    if (!target) return
    editorView.dispatch({
      selection: { anchor: target.from, head: target.to },
      scrollIntoView: true,
    })
    editorView.focus()
  }

  function referencesFileChanged(changes: Map<string, string>): boolean {
    const candidates = new Set([
      activeReferencePath.value,
      options.settingsStore.referencesBibPath,
    ].filter(Boolean))
    for (const path of changes.keys()) {
      if (candidates.has(path)) return true
    }
    return false
  }

  watch(() => options.settingsStore.referencesBibPath, () => { void loadReferences() })
  watch(citationKeySignature, () => { void loadReferences() })

  return {
    references,
    referenceLibraryActive,
    activeReferencePath,
    activeReferenceSource,
    duplicateReferenceKeys,
    bibliographyCandidates,
    bibliographyPopoverOpen,
    showBibliographyCandidates,
    referencesAddAvailable,
    getReferences,
    getDiagnostics,
    citationActions,
    citationHealth,
    showCitationStatus,
    documentCitations,
    loadReferences,
    loadReferenceToolAvailability,
    refreshCitationDecorations,
    toggleBibliographyPopover,
    closeBibliographyPopover,
    handleBibliographyOutsidePointerDown,
    useBibliographyCandidate,
    openActiveBibliography,
    jumpToCitation,
    referencesFileChanged,
  }
}

function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err || 'Unknown error')
}

function sanitizeReferenceRows(value: unknown): EditorReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): EditorReference[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    if (typeof record.key !== 'string' || !record.key) return []
    const preserved = preserveReferenceMetadata(record)
    return [{
      ...preserved,
      key: record.key,
      author: typeof record.author === 'string' ? record.author : '',
      year: typeof record.year === 'string' ? record.year : '',
      title: typeof record.title === 'string' ? record.title : record.key,
      ...(typeof record.source === 'string' ? { source: record.source } : {}),
      ...(typeof record.venue === 'string' ? { venue: record.venue } : {}),
      ...(typeof record.journal === 'string' ? { journal: record.journal } : {}),
      ...(typeof record.booktitle === 'string' ? { booktitle: record.booktitle } : {}),
      ...(typeof record.doi === 'string' ? { doi: record.doi } : {}),
      ...(typeof record.url === 'string' ? { url: record.url } : {}),
      ...(typeof record.file === 'string' ? { file: record.file } : {}),
      ...(typeof record.type === 'string' ? { type: record.type } : {}),
    }]
  })
}

function preserveReferenceMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value == null) continue
    if (key === 'fields' && typeof value === 'object' && !Array.isArray(value)) {
      out.fields = Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      continue
    }
    out[key] = value
  }
  return out
}

function sanitizeDuplicateKeys(value: unknown): Array<{ key: string; count?: number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): Array<{ key: string; count?: number }> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    if (typeof record.key !== 'string' || !record.key) return []
    return [{
      key: record.key,
      ...(typeof record.count === 'number' ? { count: record.count } : {}),
    }]
  })
}

function sanitizeBibliographyCandidates(value: unknown): BibliographyCandidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): BibliographyCandidate[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    if (typeof record.path !== 'string' || !record.path) return []
    return [{
      path: record.path,
      source: typeof record.source === 'string' ? record.source : '',
      matched: typeof record.matched === 'number' ? record.matched : 0,
      total: typeof record.total === 'number' ? record.total : 0,
      unresolvedKeys: Array.isArray(record.unresolvedKeys)
        ? record.unresolvedKeys.filter((key): key is string => typeof key === 'string')
        : [],
    }]
  })
}
