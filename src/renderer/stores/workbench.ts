import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  backHistory,
  createPaneHistory,
  forwardHistory,
  openHistoryEntry,
  removeHistoryEntry,
  replaceHistoryEntry,
  type PaneHistory,
} from '../services/workbench/history.js'
import type {
  ArtifactEntry,
  PaneConfig,
  PaneId,
  PaneLayout,
  PaneState,
  WorkEntry,
} from '../services/workbench/entries.js'

export type {
  ArtifactEntry,
  PaneConfig,
  PaneId,
  PaneLayout,
  PaneState,
  WorkEntry,
} from '../services/workbench/entries.js'

export type ArtifactReplacementDecision = 'yes' | 'no' | 'needs-confirmation'
export type ArtifactReplacementGuard = (
  current: ArtifactEntry,
  next: ArtifactEntry | null,
) => Promise<ArtifactReplacementDecision> | ArtifactReplacementDecision

export interface ArtifactMutationOptions {
  confirmReplace?: boolean
}

export interface OpenWorkOptions extends ArtifactMutationOptions {
  preserveArtifact?: boolean
}

export interface OpenArtifactOptions extends ArtifactMutationOptions {
  replace?: boolean
}

export type NavigationResult =
  | { opened: true }
  | { opened: false; reason: 'blocked' | 'needs-confirmation' }

export interface ArtifactNavigationSnapshot {
  artifactHistory: PaneHistory<ArtifactEntry>
  rememberedArtifacts: Record<string, ArtifactEntry | null>
}

const DEFAULT_LAYOUT: PaneLayout = {
  navigator: { state: 'expanded', width: 240 },
  work: { state: 'expanded', width: 640 },
  artifact: { state: 'rail', width: 520 },
}

const PANE_WIDTH_RANGES: Record<PaneId, { min: number; max?: number }> = {
  navigator: { min: 180, max: 320 },
  work: { min: 336 },
  artifact: { min: 336 },
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const workHistory = ref<PaneHistory<WorkEntry>>(createPaneHistory())
  const artifactHistory = ref<PaneHistory<ArtifactEntry>>(createPaneHistory())
  const paneLayout = reactive<PaneLayout>(cloneLayout(DEFAULT_LAYOUT))
  const rememberedArtifacts = reactive<Record<string, ArtifactEntry | null>>({})
  const viewStates = reactive<Record<string, unknown>>({})
  const navigationErrors = reactive<Record<'work' | 'artifact', unknown | null>>({
    work: null,
    artifact: null,
  })
  const replacementGuard = ref<ArtifactReplacementGuard | null>(null)

  const activeWork = computed(() => workHistory.value.current)
  const activeArtifact = computed(() => artifactHistory.value.current)
  const navigatorVisible = computed(() => paneLayout.navigator.state === 'expanded')
  const workVisible = computed(() => paneLayout.work.state === 'expanded')
  const artifactVisible = computed(() => paneLayout.artifact.state === 'expanded')
  const artifactExpanded = computed(() =>
    paneLayout.artifact.state === 'expanded' && paneLayout.work.state === 'rail'
  )
  const workExpanded = computed(() =>
    paneLayout.work.state === 'expanded' && paneLayout.artifact.state === 'rail'
  )
  const expandedPanes = computed(() =>
    (Object.keys(paneLayout) as PaneId[]).filter(pane => paneLayout[pane].state === 'expanded')
  )

  async function openWork(
    entry: WorkEntry,
    options: OpenWorkOptions = {},
  ): Promise<NavigationResult> {
    const nextArtifact = options.preserveArtifact ? undefined : artifactTargetForWork(entry)
    const decision = nextArtifact === undefined
      ? 'yes'
      : await canReplaceArtifact(nextArtifact, options)
    if (decision !== 'yes') return blockedNavigationResult(decision)

    workHistory.value = openHistoryEntry(workHistory.value, entry)
    navigationErrors.work = null
    if (nextArtifact !== undefined) replaceActiveArtifact(nextArtifact)
    normalizePaneLayout()
    return { opened: true }
  }

  async function openArtifact(
    entry: ArtifactEntry,
    options: OpenArtifactOptions = {},
  ): Promise<NavigationResult> {
    const decision = await canReplaceArtifact(entry, options)
    if (decision !== 'yes') {
      return { opened: false, reason: decision === 'no' ? 'blocked' : 'needs-confirmation' }
    }

    const nextHistory = options.replace
      ? replaceHistoryEntry(artifactHistory.value, entry)
      : openHistoryEntry(artifactHistory.value, entry)
    commitArtifactHistory(nextHistory)
    return { opened: true }
  }

  async function replaceArtifact(entry: ArtifactEntry, options: OpenArtifactOptions = {}) {
    return openArtifact(entry, { ...options, replace: true })
  }

  async function closeArtifact(
    options: ArtifactMutationOptions = {},
  ): Promise<NavigationResult> {
    const decision = await canReplaceArtifact(null, options)
    if (decision !== 'yes') return blockedNavigationResult(decision)

    commitArtifactHistory(replaceHistoryEntry(artifactHistory.value, null))
    return { opened: true }
  }

  async function back(
    pane: 'work' | 'artifact',
    options: ArtifactMutationOptions = {},
  ): Promise<NavigationResult> {
    if (pane === 'work') {
      return navigateWorkHistory(backHistory(workHistory.value), options)
    }
    return navigateArtifactHistory(backHistory(artifactHistory.value), options)
  }

  async function forward(
    pane: 'work' | 'artifact',
    options: ArtifactMutationOptions = {},
  ): Promise<NavigationResult> {
    if (pane === 'work') {
      return navigateWorkHistory(forwardHistory(workHistory.value), options)
    }
    return navigateArtifactHistory(forwardHistory(artifactHistory.value), options)
  }

  function setPaneState(pane: PaneId, state: PaneState) {
    paneLayout[pane].state = state
    restoreSiblingPaneWhenBothWorkAndArtifactAreRailed(pane, state)
    normalizePaneLayout()
  }

  function setPaneVisibility(pane: PaneId, visible: boolean) {
    setPaneState(pane, visible ? 'expanded' : 'rail')
  }

  function togglePane(pane: PaneId) {
    setPaneVisibility(pane, paneLayout[pane].state !== 'expanded')
  }

  function setPaneWidth(pane: PaneId, width: number) {
    paneLayout[pane].width = clampPaneWidth(pane, width)
    normalizePaneLayout()
  }

  function setArtifactExpanded(expanded: boolean) {
    paneLayout.artifact.state = 'expanded'
    paneLayout.work.state = expanded ? 'rail' : 'expanded'
    normalizePaneLayout()
  }

  function setWorkExpanded(expanded: boolean) {
    paneLayout.work.state = 'expanded'
    paneLayout.artifact.state = expanded ? 'rail' : 'expanded'
    normalizePaneLayout()
  }

  function setPaneLayout(next: Partial<Record<PaneId, Partial<PaneConfig>>>) {
    for (const pane of Object.keys(next) as PaneId[]) {
      Object.assign(paneLayout[pane], next[pane])
      paneLayout[pane].width = clampPaneWidth(pane, paneLayout[pane].width)
    }
    normalizePaneLayout()
  }

  function setNavigationError(pane: 'work' | 'artifact', error: unknown) {
    navigationErrors[pane] = error
  }

  function setArtifactReplacementGuard(guard: ArtifactReplacementGuard | null) {
    replacementGuard.value = guard
  }

  function createArtifactNavigationSnapshot(): ArtifactNavigationSnapshot {
    return {
      artifactHistory: cloneHistory(artifactHistory.value),
      rememberedArtifacts: cloneRememberedArtifacts(rememberedArtifacts),
    }
  }

  function restoreArtifactNavigationSnapshot(snapshot: ArtifactNavigationSnapshot) {
    artifactHistory.value = cloneHistory(snapshot.artifactHistory)
    replaceRecord(rememberedArtifacts, cloneRememberedArtifacts(snapshot.rememberedArtifacts))
  }

  async function removePaneHistoryEntry(
    pane: 'work' | 'artifact',
    entryId: string,
    options: ArtifactMutationOptions = {},
  ): Promise<NavigationResult> {
    if (pane === 'work') {
      workHistory.value = removeHistoryEntry(workHistory.value, entryId)
      navigationErrors.work = null
      normalizePaneLayout()
      return { opened: true }
    }

    const nextHistory = removeHistoryEntry(artifactHistory.value, entryId)
    return navigateArtifactHistory(nextHistory, options)
  }

  function setViewState(entryId: string, state: unknown) {
    viewStates[entryId] = state
  }

  function patchViewState(entryId: string, patch: Record<string, unknown>) {
    const current = viewStates[entryId]
    viewStates[entryId] = {
      ...(isRecord(current) ? current : {}),
      ...patch,
    }
  }

  function getViewState<T = unknown>(entryId: string): T | undefined {
    return viewStates[entryId] as T | undefined
  }

  function resetForWorkspace() {
    workHistory.value = createPaneHistory()
    artifactHistory.value = createPaneHistory()
    navigationErrors.work = null
    navigationErrors.artifact = null
    replacementGuard.value = null
    clearRecord(rememberedArtifacts)
    clearRecord(viewStates)
    Object.assign(paneLayout.navigator, DEFAULT_LAYOUT.navigator)
    Object.assign(paneLayout.work, DEFAULT_LAYOUT.work)
    Object.assign(paneLayout.artifact, DEFAULT_LAYOUT.artifact)
    normalizePaneLayout()
  }

  async function canReplaceArtifact(
    next: ArtifactEntry | null,
    options: ArtifactMutationOptions,
  ): Promise<ArtifactReplacementDecision> {
    const current = activeArtifact.value
    if (!current || current.id === next?.id) return 'yes'
    if (!replacementGuard.value) return 'yes'

    const decision = await replacementGuard.value(current, next)
    if (decision === 'needs-confirmation' && options.confirmReplace) return 'yes'
    return decision
  }

  async function navigateWorkHistory(
    nextHistory: PaneHistory<WorkEntry>,
    options: ArtifactMutationOptions,
  ): Promise<NavigationResult> {
    if (nextHistory === workHistory.value) return { opened: true }

    const nextArtifact = nextHistory.current ? artifactTargetForWork(nextHistory.current) : undefined
    const decision = nextArtifact === undefined
      ? 'yes'
      : await canReplaceArtifact(nextArtifact, options)
    if (decision !== 'yes') return blockedNavigationResult(decision)

    workHistory.value = nextHistory
    navigationErrors.work = null
    if (nextArtifact !== undefined) replaceActiveArtifact(nextArtifact)
    normalizePaneLayout()
    return { opened: true }
  }

  async function navigateArtifactHistory(
    nextHistory: PaneHistory<ArtifactEntry>,
    options: ArtifactMutationOptions,
  ): Promise<NavigationResult> {
    if (nextHistory === artifactHistory.value) return { opened: true }

    const decision = await canReplaceArtifact(nextHistory.current, options)
    if (decision !== 'yes') return blockedNavigationResult(decision)

    commitArtifactHistory(nextHistory)
    return { opened: true }
  }

  function artifactTargetForWork(entry: WorkEntry): ArtifactEntry | null | undefined {
    if (!activeArtifact.value && rememberedArtifacts[entry.id]) {
      return rememberedArtifacts[entry.id]
    }
    return undefined
  }

  function replaceActiveArtifact(entry: ArtifactEntry | null) {
    commitArtifactHistory(replaceHistoryEntry(artifactHistory.value, entry))
  }

  function commitArtifactHistory(nextHistory: PaneHistory<ArtifactEntry>) {
    artifactHistory.value = nextHistory
    navigationErrors.artifact = null
    if (activeWork.value) {
      rememberedArtifacts[activeWork.value.id] = activeArtifact.value
    }
    normalizePaneLayout()
  }

  function blockedNavigationResult(decision: Exclude<ArtifactReplacementDecision, 'yes'>): NavigationResult {
    return { opened: false, reason: decision === 'no' ? 'blocked' : 'needs-confirmation' }
  }

  function normalizePaneLayout() {
    const expanded = (Object.keys(paneLayout) as PaneId[])
      .filter(pane => paneLayout[pane].state === 'expanded')
    if (expanded.length === 0) {
      paneLayout.work.state = 'expanded'
    }
  }

  function restoreSiblingPaneWhenBothWorkAndArtifactAreRailed(pane: PaneId, state: PaneState) {
    if (state !== 'rail') return
    if (pane === 'work' && paneLayout.artifact.state === 'rail') {
      paneLayout.artifact.state = 'expanded'
    }
    if (pane === 'artifact' && paneLayout.work.state === 'rail') {
      paneLayout.work.state = 'expanded'
    }
  }

  return {
    workHistory,
    artifactHistory,
    paneLayout,
    rememberedArtifacts,
    navigationErrors,
    activeWork,
    activeArtifact,
    navigatorVisible,
    workVisible,
    artifactVisible,
    artifactExpanded,
    workExpanded,
    expandedPanes,
    openWork,
    openArtifact,
    replaceArtifact,
    closeArtifact,
    back,
    forward,
    setPaneState,
    setPaneVisibility,
    togglePane,
    setPaneWidth,
    setArtifactExpanded,
    setWorkExpanded,
    setPaneLayout,
    setNavigationError,
    setArtifactReplacementGuard,
    createArtifactNavigationSnapshot,
    restoreArtifactNavigationSnapshot,
    removePaneHistoryEntry,
    setViewState,
    patchViewState,
    getViewState,
    resetForWorkspace,
  }
})

function cloneLayout(layout: PaneLayout): PaneLayout {
  return {
    navigator: { ...layout.navigator, width: clampPaneWidth('navigator', layout.navigator.width) },
    work: { ...layout.work, width: clampPaneWidth('work', layout.work.width) },
    artifact: { ...layout.artifact, width: clampPaneWidth('artifact', layout.artifact.width) },
  }
}

function clampPaneWidth(pane: PaneId, width: number): number {
  const range = PANE_WIDTH_RANGES[pane]
  const fallback = DEFAULT_LAYOUT[pane].width
  const finiteWidth = Number.isFinite(width) ? width : fallback
  const minClamped = Math.max(range.min, finiteWidth)
  return typeof range.max === 'number' ? Math.min(range.max, minClamped) : minClamped
}

function clearRecord(record: Record<string, unknown>) {
  for (const key of Object.keys(record)) delete record[key]
}

function replaceRecord<T>(
  record: Record<string, T>,
  next: Record<string, T>,
) {
  for (const key of Object.keys(record)) delete record[key]
  Object.assign(record, next)
}

function cloneEntry<T extends { id: string }>(entry: T | null): T | null {
  return entry ? { ...entry } : null
}

function cloneHistory<T extends { id: string }>(history: PaneHistory<T>): PaneHistory<T> {
  return {
    current: cloneEntry(history.current),
    backStack: history.backStack.map(entry => ({ ...entry })),
    forwardStack: history.forwardStack.map(entry => ({ ...entry })),
  }
}

function cloneRememberedArtifacts(
  artifacts: Record<string, ArtifactEntry | null>,
): Record<string, ArtifactEntry | null> {
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, entry]) => [key, cloneEntry(entry)]),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
