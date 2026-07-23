<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { rankFiles } from '../../services/fuzzy.js'
import { useWorkspaceFileIndex, type IndexedFile } from '../../services/workspaceFileIndex.js'
import { defaultOpenTargetForPath } from '../../services/fileOpenPolicy.js'
import { useToastStore } from '../../stores/toasts.js'
import FilesContextMenu from './FilesContextMenu.vue'
import FilesTable from './FilesTable.vue'
import FilesWorkToolbar from './FilesWorkToolbar.vue'
import MimContextMenu from '../ui/MimContextMenu.vue'
import MimDialog from '../ui/MimDialog.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import {
  baseName,
  compareRows as compareFileRows,
  dirOf,
  entryToRow,
  fileToRow,
  isFileContentMatch,
  isFsEntry,
  parentDir,
  sortEntries as sortFileEntries,
} from './fileDisplay.js'
import type {
  BreadcrumbItem,
  FileContentMatch,
  FileRow,
  FileRowBase,
  FsEntry,
  Mode,
  RowCompareOptions,
  SortDirection,
  SortKey,
  TableMode,
} from './fileTypes.js'
import {
  buildWorkspaceMovePlan,
  pruneNestedDragItems,
  type WorkspaceDragItem,
  type WorkspaceDragPayload,
  type WorkspaceMoveResult,
} from './fileMove.js'
import {
  emptySelection,
  pruneSelection,
  reduceRowClick,
  type FileSelection,
} from './fileSelection.js'

const props = withDefaults(defineProps<{
  active?: boolean
  refreshKey?: number
  recentFiles?: Array<{ path: string; name: string }>
  activeFilePath?: string
}>(), {
  active: true,
  refreshKey: 0,
  recentFiles: () => [],
  activeFilePath: '',
})

const emit = defineEmits<{
  openFile: [path: string]
  openFileNative: [path: string]
  openFileHistory: [path: string]
  newFile: []
  openFileDialog: []
  pathMoved: [move: WorkspaceMoveResult]
}>()

const DIRECTORY_LIMIT = 500
const CHANGED_LIMIT = 240
const SEARCH_LIMIT = 80
const CONTENT_SEARCH_LIMIT = 40
const CONTENT_SEARCH_DELAY = 180

const index = useWorkspaceFileIndex()
const toastStore = useToastStore()
const toolbarRef = ref<InstanceType<typeof FilesWorkToolbar> | null>(null)
const query = ref('')
const mode = ref<Mode>('browse')
const currentDir = ref('.')
const directoryEntries = ref<FsEntry[]>([])
const teamName = ref('')
const directoryError = ref('')
const directoryLoading = ref(false)
const selectedIndex = ref(0)
const selection = ref<FileSelection>(emptySelection())
const expandedPaths = ref<Set<string>>(new Set())
const expandedChildren = ref<Record<string, FsEntry[]>>({})
const expandedLoading = ref<Set<string>>(new Set())
const contextRow = ref<FileRow | null>(null)
const contentMatches = ref<FileContentMatch[]>([])
const contentSearchLoading = ref(false)
const contentSearchError = ref('')
const awarenessChanges = ref<Array<{
  path: string
  name: string
  size: number
  author: string
  changedAt: string
  summary: string
}>>([])
const awarenessLoading = ref(false)
const awarenessError = ref('')
const sortKey = ref<SortKey>('modifiedAt')
const sortDirection = ref<SortDirection>('desc')
const sortTouched = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
let loadToken = 0
let searchToken = 0
let searchTimer: number | null = null

const recentPaths = computed(() => props.recentFiles.map(file => file.path))
const metadataByPath = computed(() => {
  const map = new Map<string, IndexedFile>()
  for (const file of index.files.value as IndexedFile[]) map.set(file.path, file)
  return map
})

const tableMode = computed<TableMode>(() => query.value.trim() ? 'search' : mode.value)
const showLocationColumn = computed(() => tableMode.value !== 'browse')
const sortOptions = computed<RowCompareOptions>(() => ({
  sortKey: sortKey.value,
  sortDirection: sortDirection.value,
  showLocationColumn: showLocationColumn.value,
  showChangedByColumn: tableMode.value === 'changed',
}))

const breadcrumbItems = computed<BreadcrumbItem[]>(() => {
  const items: BreadcrumbItem[] = [{ label: 'workspace', path: '.' }]
  if (currentDir.value === '.') return items
  const parts = currentDir.value.split('/').filter(Boolean)
  let path = ''
  for (const part of parts) {
    path = path ? `${path}/${part}` : part
    items.push({ label: part, path })
  }
  return items
})

// Team Files is the one shared, writable root. The mount covers the checkout,
// while Files exposes only its files/ contribution.
const teamRootRow = computed<FileRowBase | null>(() =>
  teamName.value
    ? {
        path: '.mim/team/files',
        name: 'Files',
        dir: 'team',
        type: 'directory' as const,
        kind: 'Team',
        positions: [],
        level: 0,
        sectionLabel: teamName.value,
      }
    : null
)

const browseRows = computed<FileRowBase[]>(() => {
  const base = buildBrowseRows(sortFileEntries(directoryEntries.value, sortOptions.value), 0)
  if (currentDir.value === '.' && teamRootRow.value) {
    const out = [...base]
    const root = teamRootRow.value
    out.push(root)
    if (expandedPaths.value.has(root.path)) {
      out.push(...buildBrowseRows(sortFileEntries(expandedChildren.value[root.path] ?? [], sortOptions.value), 1))
    }
    return out
  }
  return base
})

const changedRows = computed<FileRowBase[]>(() =>
  awarenessChanges.value.map(change => fileToRow({
    path: change.path,
    name: change.name,
    size: change.size,
    modifiedAt: change.changedAt,
    lastChangedBy: change.author,
    changeSummary: change.summary,
  }))
)

const recentRows = computed<FileRowBase[]>(() =>
  props.recentFiles.map(file => {
    const indexed = metadataByPath.value.get(file.path)
    return fileToRow({
      path: file.path,
      name: file.name,
      dir: indexed?.dir ?? dirOf(file.path),
      size: indexed?.size,
      modifiedAt: indexed?.modifiedAt,
      createdAt: indexed?.createdAt,
      lastChangedBy: indexed?.lastChangedBy,
    })
  })
)

const searchRows = computed<FileRowBase[]>(() => buildSearchRows())

const rows = computed<FileRow[]>(() => {
  const source = tableMode.value === 'search'
    ? searchRows.value
    : tableMode.value === 'recent'
      ? recentRows.value
      : tableMode.value === 'changed'
        ? changedRows.value
        : browseRows.value
  const sorted = tableMode.value !== 'browse' && (sortTouched.value || tableMode.value === 'changed')
    ? source.slice().sort((a, b) => compareFileRows(a, b, sortOptions.value))
    : source
  return sorted.map((row, gi) => ({ ...row, gi }))
})

const selectedRow = computed(() => rows.value.find(row => row.gi === selectedIndex.value) ?? null)
const selectedPathSet = computed(() => new Set(selection.value.paths))
const selectablePaths = computed(() => rows.value.filter(row => !row.disabled).map(row => row.path))
const emptyText = computed(() => {
  if (tableMode.value === 'search') {
    if (contentSearchLoading.value) return 'Searching files'
    return contentSearchError.value || 'No matching files'
  }
  if (tableMode.value === 'recent') return 'No recent files'
  if (tableMode.value === 'changed') {
    if (awarenessLoading.value) return 'Loading fetched changes'
    return awarenessError.value || 'No fetched Git changes'
  }
  return directoryLoading.value ? 'Loading files' : 'No files'
})
watch(currentDir, (path) => {
  selectedIndex.value = 0
  selection.value = emptySelection()
  closeContextMenu()
  expandedPaths.value = new Set()
  expandedChildren.value = {}
  void loadDirectory(path)
  if (path === '.') void loadTeamRoot()
}, { immediate: true })

watch([query, mode], () => {
  selectedIndex.value = 0
  selection.value = emptySelection()
  closeContextMenu()
})

// Rows change on refresh, collapse, delete, sort: keep only still-visible
// paths so bulk actions never target hidden rows.
watch(rows, (next) => {
  selection.value = pruneSelection(selection.value, next.map(row => row.path))
})

watch(query, (value) => {
  scheduleContentSearch(value)
}, { immediate: true })

watch(() => rows.value.length, (count) => {
  if (selectedIndex.value >= count) selectedIndex.value = Math.max(0, count - 1)
})

watch(
  () => [props.active, props.refreshKey] as const,
  ([active, refreshKey], [wasActive, previousRefreshKey]) => {
    if (!active) return
    if (wasActive === false || (wasActive === true && refreshKey !== previousRefreshKey)) {
      void refresh()
    }
  },
)

onMounted(() => {
  void index.load()
  toolbarRef.value?.focusSearch()
})

onBeforeUnmount(() => {
  searchToken++
  if (searchTimer !== null) window.clearTimeout(searchTimer)
})

async function loadDirectory(path: string) {
  const token = ++loadToken
  directoryLoading.value = true
  directoryError.value = ''
  try {
    const result = await window.kernel.call('fs.list', {
      path,
      max_entries: DIRECTORY_LIMIT,
      include_last_changed_by: true,
    }) as { entries?: FsEntry[]; truncated?: boolean }
    if (token !== loadToken) return
    directoryEntries.value = (result.entries ?? []).filter(isFsEntry)
  } catch (err) {
    if (token !== loadToken) return
    directoryEntries.value = []
    directoryError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (token === loadToken) directoryLoading.value = false
  }
}

// The section header pins to the bottom of the scroll pane (sticky) so the
// group stays discoverable under a long workspace listing; clicking it brings
// the section itself into view.
function scrollToTeam(event: MouseEvent) {
  (event.currentTarget as HTMLElement | null)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

async function loadTeamRoot() {
  try {
    const result = await window.kernel.call('team.status') as {
      team?: { name?: unknown } | null
    }
    teamName.value = typeof result.team?.name === 'string' ? result.team.name : ''
  } catch {
    teamName.value = ''
  }
}

async function refreshExpandedChildren() {
  const paths = [...expandedPaths.value]
  if (!paths.length) return
  const next: Record<string, FsEntry[]> = {}
  await Promise.all(paths.map(async (path) => {
    try {
      const result = await window.kernel.call('fs.list', {
        path,
        max_entries: DIRECTORY_LIMIT,
        include_last_changed_by: true,
      }) as { entries?: FsEntry[] }
      next[path] = (result.entries ?? []).filter(isFsEntry)
    } catch {
      const updated = new Set(expandedPaths.value)
      updated.delete(path)
      expandedPaths.value = updated
    }
  }))
  expandedChildren.value = next
}

async function refresh() {
  await Promise.all([
    loadDirectory(currentDir.value),
    loadTeamRoot(),
    index.refresh(),
    refreshExpandedChildren(),
    ...(mode.value === 'changed' ? [loadAwareness()] : []),
  ])
}

async function loadAwareness() {
  awarenessLoading.value = true
  awarenessError.value = ''
  try {
    const result = await window.kernel.call('awareness.recent', { limit: CHANGED_LIMIT }) as {
      changes?: typeof awarenessChanges.value
    }
    awarenessChanges.value = Array.isArray(result.changes) ? result.changes : []
  } catch (err) {
    awarenessChanges.value = []
    awarenessError.value = err instanceof Error ? err.message : String(err)
  } finally {
    awarenessLoading.value = false
  }
}

function buildSearchRows(): FileRowBase[] {
  const byPath = new Map<string, FileRowBase>()
  const ranked = rankFiles(query.value, index.files.value as IndexedFile[], recentPaths.value, SEARCH_LIMIT)

  for (const result of ranked) {
    byPath.set(result.file.path, {
      ...fileToRow(result.file),
      positions: result.matchedName ? result.positions : [],
    })
  }

  for (const match of contentMatches.value) {
    const existing = byPath.get(match.path)
    if (existing) {
      if (!existing.searchSnippet) {
        existing.searchLine = match.line
        existing.searchSnippet = match.snippet
      }
      continue
    }

    const indexed = metadataByPath.value.get(match.path)
    const row = fileToRow(indexed ?? {
      path: match.path,
      name: baseName(match.path),
      dir: dirOf(match.path),
    })
    row.searchLine = match.line
    row.searchSnippet = match.snippet
    byPath.set(match.path, row)
  }

  return Array.from(byPath.values()).slice(0, SEARCH_LIMIT)
}

function scheduleContentSearch(value: string) {
  const q = value.trim()
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }
  contentSearchError.value = ''
  if (q.length < 2) {
    searchToken++
    contentMatches.value = []
    contentSearchLoading.value = false
    return
  }

  const token = ++searchToken
  contentSearchLoading.value = true
  searchTimer = window.setTimeout(() => {
    void loadContentMatches(q, token)
  }, CONTENT_SEARCH_DELAY)
}

async function loadContentMatches(q: string, token: number) {
  try {
    const result = await window.kernel.call('search.files', {
      query: q,
      max_results: CONTENT_SEARCH_LIMIT,
    }) as { results?: FileContentMatch[] }
    if (token !== searchToken) return
    contentMatches.value = (result.results ?? []).filter(isFileContentMatch)
  } catch (err) {
    if (token !== searchToken) return
    contentMatches.value = []
    contentSearchError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (token === searchToken) contentSearchLoading.value = false
  }
}

function buildBrowseRows(entries: FsEntry[], level: number): FileRowBase[] {
  const out: FileRowBase[] = []
  for (const entry of entries) {
    out.push(entryToRow(entry, level))
    if (entry.type === 'directory' && expandedPaths.value.has(entry.path)) {
      out.push(...buildBrowseRows(sortFileEntries(expandedChildren.value[entry.path] ?? [], sortOptions.value), level + 1))
    }
  }
  return out
}

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDirection.value = key === 'name' || key === 'kindOrLocation' ? 'asc' : 'desc'
  }
  sortTouched.value = true
}

function selectRow(index: number) {
  selectedIndex.value = index
}

function activateSelected() {
  const row = selectedRow.value
  if (row) activateRow(row)
}

function activateRow(row: FileRow) {
  closeContextMenu()
  if (row.disabled) return
  if (row.type === 'directory') {
    navigateTo(row.path || '.')
    return
  }
  emit('openFile', row.path)
}

async function toggleFolder(row: FileRow) {
  if (row.type !== 'directory') return
  const next = new Set(expandedPaths.value)
  if (next.has(row.path)) {
    next.delete(row.path)
    expandedPaths.value = next
    return
  }
  next.add(row.path)
  expandedPaths.value = next
  if (expandedChildren.value[row.path]) return

  const loading = new Set(expandedLoading.value)
  loading.add(row.path)
  expandedLoading.value = loading
  try {
    const result = await window.kernel.call('fs.list', {
      path: row.path,
      max_entries: DIRECTORY_LIMIT,
      include_last_changed_by: true,
    }) as { entries?: FsEntry[] }
    expandedChildren.value = {
      ...expandedChildren.value,
      [row.path]: (result.entries ?? []).filter(isFsEntry),
    }
  } catch {
    expandedChildren.value = { ...expandedChildren.value, [row.path]: [] }
  } finally {
    const done = new Set(expandedLoading.value)
    done.delete(row.path)
    expandedLoading.value = done
  }
}

async function handleRowClick(row: FileRow, event?: MouseEvent) {
  selectRow(row.gi)
  if (row.disabled) return
  const { selection: next, activate } = reduceRowClick(
    selection.value,
    selectablePaths.value,
    row.path,
    {
      toggle: !!(event && (event.metaKey || event.ctrlKey)),
      range: !!event?.shiftKey,
    },
  )
  selection.value = next
  // Modified clicks only adjust the selection; they never open or expand.
  if (!activate) return
  if (row.type === 'directory') {
    await toggleFolder(row)
    return
  }
  // Every file click opens something: editor, PDF viewer, or file card.
  emit('openFile', row.path)
}

function handleRowDoubleClick(row: FileRow, event?: MouseEvent) {
  if (row.disabled) return
  if (event && (event.metaKey || event.ctrlKey || event.shiftKey)) return
  if (row.type === 'directory') {
    activateRow(row)
    return
  }
  // Files whose card is the single-click result open externally on double-click.
  if (defaultOpenTargetForPath(row.path) === 'native') emit('openFileNative', row.path)
}

async function revealSelected() {
  const row = selectedRow.value
  if (!row) return
  await window.kernel.revealInFinder(row.path)
}

function setMode(next: Mode) {
  mode.value = next
  query.value = ''
  if (next === 'changed') void loadAwareness()
}

function navigateTo(path: string) {
  currentDir.value = path || '.'
  mode.value = 'browse'
  query.value = ''
}

function navigateUp() {
  if (currentDir.value === '.') return
  navigateTo(parentDir(currentDir.value))
}

function moveSelection(delta: number) {
  const count = rows.value.length
  if (!count) return
  selectedIndex.value = (selectedIndex.value + delta + count) % count
}

function onKeydown(event: KeyboardEvent) {
  const meta = event.metaKey || event.ctrlKey
  if (event.key === 'Escape' && selection.value.paths.length) {
    event.preventDefault()
    event.stopPropagation()
    selection.value = emptySelection()
    return
  }
  // Only hijack cmd/ctrl+A when the search box has no text to select — same
  // guard shape as the Backspace-to-navigate-up case below.
  if (meta && event.key === 'a' && !query.value) {
    event.preventDefault()
    event.stopPropagation()
    const paths = selectablePaths.value
    selection.value = { paths, anchorPath: paths[0] ?? null }
    return
  }
  if (meta && event.key === 'n') {
    event.preventDefault()
    event.stopPropagation()
    emit('newFile')
    return
  }
  if (meta && event.key === 'o') {
    event.preventDefault()
    event.stopPropagation()
    emit('openFileDialog')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    event.stopPropagation()
    moveSelection(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    event.stopPropagation()
    moveSelection(-1)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    activateSelected()
    return
  }
  if (event.key === 'Backspace' && tableMode.value === 'browse' && !query.value && currentDir.value !== '.') {
    event.preventDefault()
    event.stopPropagation()
    navigateUp()
  }
}

function newDraftFromMenu() {
  emit('newFile')
}

function openFileFromMenu() {
  emit('openFileDialog')
}

function openContextMenu(row: FileRow, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  selectRow(row.gi)
  // Right-click inside a multi-selection keeps it (the menu acts on all of
  // it); outside, the selection collapses to the clicked row.
  if (!(selection.value.paths.length > 1 && selection.value.paths.includes(row.path))) {
    selection.value = row.disabled
      ? emptySelection()
      : { paths: [row.path], anchorPath: row.path }
  }
  contextRow.value = row
  contextMenuPos.value = { x: event.clientX, y: event.clientY }
}

const contextSelectionCount = computed(() => {
  const row = contextRow.value
  if (!row) return 0
  const paths = selection.value.paths
  return paths.length > 1 && paths.includes(row.path) ? paths.length : 0
})

function closeContextMenu() {
  contextRow.value = null
}

function contextOpen() {
  const row = contextRow.value
  if (!row) return
  closeContextMenu()
  // The menu's primary open matches its label: "Open in Microsoft Word" /
  // "Open in default app" rows open externally, everything else in Artifact.
  if (row.type !== 'directory' && defaultOpenTargetForPath(row.path) === 'native') {
    emit('openFileNative', row.path)
    return
  }
  activateRow(row)
}

function contextOpenNative() {
  const row = contextRow.value
  if (!row || row.type === 'directory') return
  closeContextMenu()
  emit('openFileNative', row.path)
}

function contextVersionHistory() {
  const row = contextRow.value
  if (!row || row.type === 'directory') return
  closeContextMenu()
  emit('openFileHistory', row.path)
}

async function contextToggleFolder() {
  const row = contextRow.value
  if (!row || row.type !== 'directory') return
  await toggleFolder(row)
  closeContextMenu()
}

async function contextReveal() {
  await revealSelected()
  closeContextMenu()
}

async function copySelectedPath() {
  const row = contextRow.value ?? selectedRow.value
  if (!row) return
  await navigator.clipboard?.writeText?.(row.path)
  closeContextMenu()
}

function isExpanded(path: string): boolean {
  return expandedPaths.value.has(path)
}

// ── File operations (new file/folder, rename, duplicate, trash) ──

type NameAction =
  | { kind: 'new-file'; dir: string }
  | { kind: 'new-folder'; dir: string }
  | { kind: 'rename'; path: string; type: 'directory' | 'file' }

const nameAction = ref<NameAction | null>(null)
const nameInput = ref('')
const nameError = ref('')
const nameBusy = ref(false)
const emptyMenuPos = ref<{ x: number; y: number } | null>(null)

const nameDialogTitle = computed(() => {
  if (nameAction.value?.kind === 'new-file') return 'New file'
  if (nameAction.value?.kind === 'new-folder') return 'New folder'
  return 'Rename'
})

const nameDialogConfirmLabel = computed(() =>
  nameAction.value?.kind === 'rename' ? 'Rename' : 'Create',
)

// File operations land in the visible folder; outside Browse they target the
// workspace root.
function currentOpsDir(): string {
  return tableMode.value === 'browse' ? currentDir.value : '.'
}

function joinDir(dir: string, name: string): string {
  return dir === '.' || dir === '' ? name : `${dir}/${name}`
}

function promptNameAction(action: NameAction) {
  closeContextMenu()
  emptyMenuPos.value = null
  nameAction.value = action
  nameInput.value = action.kind === 'rename' ? baseName(action.path) : ''
  nameError.value = ''
}

function promptNewFile(dir = currentOpsDir()) {
  promptNameAction({ kind: 'new-file', dir })
}

function promptNewFolder(dir = currentOpsDir()) {
  promptNameAction({ kind: 'new-folder', dir })
}

function closeNameDialog() {
  if (nameBusy.value) return
  nameAction.value = null
}

async function confirmNameAction() {
  const action = nameAction.value
  if (!action || nameBusy.value) return
  const name = nameInput.value.trim()
  if (!name) {
    nameError.value = 'Enter a name.'
    return
  }
  nameBusy.value = true
  nameError.value = ''
  try {
    if (action.kind === 'new-file') {
      const path = joinDir(action.dir, name)
      await window.kernel.call('fs.create', { path })
      nameAction.value = null
      await refresh()
      emit('openFile', path)
    } else if (action.kind === 'new-folder') {
      await window.kernel.call('fs.mkdir', { path: joinDir(action.dir, name) })
      nameAction.value = null
      await refresh()
    } else {
      const newPath = joinDir(parentDir(action.path), name)
      if (newPath !== action.path) {
        await window.kernel.call('fs.rename', { old_path: action.path, new_path: newPath })
      }
      nameAction.value = null
      await refresh()
    }
  } catch (err) {
    nameError.value = err instanceof Error ? err.message : String(err)
  } finally {
    nameBusy.value = false
  }
}

function contextNewFileInside() {
  const row = contextRow.value
  if (!row || row.type !== 'directory') return
  promptNewFile(row.path)
}

function contextNewFolderInside() {
  const row = contextRow.value
  if (!row || row.type !== 'directory') return
  promptNewFolder(row.path)
}

function contextRename() {
  const row = contextRow.value
  if (!row) return
  promptNameAction({ kind: 'rename', path: row.path, type: row.type })
}

async function contextDuplicate() {
  const row = contextRow.value
  if (!row) return
  closeContextMenu()
  try {
    await window.kernel.call('fs.copy', { path: row.path })
    await refresh()
  } catch (err) {
    console.error('[files] duplicate', err)
  }
}

// Delete is confirmed first and always lands in the OS Trash (recoverable),
// never a hard delete. Bulk deletes carry every selected item.
const deleteTarget = ref<{ items: WorkspaceDragItem[] } | null>(null)
const deleteError = ref('')
const deleteBusy = ref(false)

const deleteDialogLabel = computed(() => {
  const items = deleteTarget.value?.items ?? []
  if (items.length > 1) return `Delete ${items.length} items`
  return items[0]?.type === 'directory' ? 'Delete folder' : 'Delete file'
})

function contextTrash() {
  const row = contextRow.value
  if (!row) return
  closeContextMenu()
  deleteError.value = ''
  deleteTarget.value = { items: [{ path: row.path, type: row.type }] }
}

// ── Bulk actions over the multi-selection ──

function selectedItems(): WorkspaceDragItem[] {
  return rows.value
    .filter(row => selectedPathSet.value.has(row.path))
    .map(row => ({ path: row.path, type: row.type }))
}

function contextTrashSelection() {
  const items = pruneNestedDragItems(selectedItems())
  closeContextMenu()
  if (!items.length) return
  deleteError.value = ''
  deleteTarget.value = { items }
}

async function copySelectionPaths() {
  const paths = selection.value.paths
  closeContextMenu()
  if (!paths.length) return
  await navigator.clipboard?.writeText?.(paths.join('\n'))
}

function clearSelection() {
  selection.value = emptySelection()
  closeContextMenu()
}

function closeDeleteDialog() {
  if (deleteBusy.value) return
  deleteTarget.value = null
}

async function confirmDelete() {
  const target = deleteTarget.value
  if (!target || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = ''
  let firstError = ''
  for (const item of target.items) {
    try {
      await window.kernel.call('fs.trash', { path: item.path })
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err)
    }
  }
  if (firstError) deleteError.value = firstError
  else deleteTarget.value = null
  await refresh()
  deleteBusy.value = false
}

function openEmptyContextMenu(event: MouseEvent) {
  event.preventDefault()
  closeContextMenu()
  emptyMenuPos.value = { x: event.clientX, y: event.clientY }
}

// Files dragged in from the OS: copy each into the drop target (hovered
// folder row, else the visible folder) via fs.import.
async function handleExternalDrop(files: File[], targetDir: string | null) {
  const dest = targetDir ?? currentOpsDir()
  let imported = 0
  let failed = 0
  for (const file of files) {
    try {
      const sourcePath = window.kernel.getPathForFile?.(file)
      if (!sourcePath) continue
      await window.kernel.call('fs.import', { source_path: sourcePath, dest_dir: dest })
      imported++
    } catch (err) {
      failed++
      console.error('[files] import', err)
    }
  }
  if (imported > 0) await refresh()
  if (failed > 0) {
    toastStore.push({
      kind: 'error',
      message: 'Import failed',
      detail: `${failed} item${failed === 1 ? '' : 's'} could not be imported.`,
    })
  }
}

async function handleWorkspaceDrop(source: WorkspaceDragPayload, targetDir: string | null) {
  const dest = targetDir ?? currentOpsDir()
  const moves: WorkspaceMoveResult[] = []
  const blockedReasons: string[] = []
  for (const item of pruneNestedDragItems(source.items)) {
    const plan = buildWorkspaceMovePlan(item, dest)
    if (plan.ok) moves.push(plan.move)
    else if (plan.reason !== 'Already in this folder.') blockedReasons.push(plan.reason)
  }
  if (!moves.length) {
    // Silent when every item was already in place; otherwise say why.
    if (blockedReasons.length) {
      toastStore.push({ kind: 'info', message: 'Move skipped', detail: blockedReasons[0] })
    }
    return
  }
  let failed = 0
  let failMessage = ''
  for (const move of moves) {
    try {
      await window.kernel.call('fs.rename', {
        old_path: move.oldPath,
        new_path: move.newPath,
      })
      emit('pathMoved', move)
    } catch (err) {
      failed++
      if (!failMessage) failMessage = err instanceof Error ? err.message : String(err)
      console.error('[files] move', err)
    }
  }
  if (failed > 0) {
    toastStore.push({
      kind: 'error',
      message: 'Move failed',
      detail: moves.length === 1 ? failMessage : `${failed} item${failed === 1 ? '' : 's'} could not be moved.`,
    })
  }
  if (failed < moves.length) await refresh()
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-chrome-high" aria-label="Files">
    <FilesWorkToolbar
      ref="toolbarRef"
      v-model:query="query"
      :table-mode="tableMode"
      :current-dir="currentDir"
      :breadcrumb-items="breadcrumbItems"
      :content-search-loading="contentSearchLoading"
      @set-mode="setMode"
      @navigate-to="navigateTo"
      @navigate-up="navigateUp"
      @refresh="refresh"
      @new-draft="newDraftFromMenu"
      @new-file="promptNewFile()"
      @new-folder="promptNewFolder()"
      @open-file-dialog="openFileFromMenu"
      @search-keydown="onKeydown"
    />

    <FilesTable
      :rows="rows"
      :table-mode="tableMode"
      :show-location-column="showLocationColumn"
      :show-changed-by-column="tableMode === 'changed'"
      :selected-index="selectedIndex"
      :query="query"
      :active-file-path="activeFilePath"
      :empty-text="emptyText"
      :directory-error="directoryError"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :expanded-paths="expandedPaths"
      :expanded-loading="expandedLoading"
      :selected-paths="selectedPathSet"
      @set-sort="setSort"
      @row-click="handleRowClick"
      @row-mouseenter="selectRow"
      @row-dblclick="handleRowDoubleClick"
      @row-contextmenu="openContextMenu"
      @empty-contextmenu="openEmptyContextMenu"
      @drop-external="handleExternalDrop"
      @drop-workspace="handleWorkspaceDrop"
      @scroll-to-team="scrollToTeam"
    />

    <FilesContextMenu
      v-if="contextRow"
      :row="contextRow"
      :x="contextMenuPos.x"
      :y="contextMenuPos.y"
      :expanded="isExpanded(contextRow.path)"
      :selection-count="contextSelectionCount"
      @close="closeContextMenu"
      @open="contextOpen"
      @open-native="contextOpenNative"
      @version-history="contextVersionHistory"
      @toggle-folder="contextToggleFolder"
      @new-file="contextNewFileInside"
      @new-folder="contextNewFolderInside"
      @rename="contextRename"
      @duplicate="contextDuplicate"
      @trash="contextTrash"
      @reveal="contextReveal"
      @copy-path="copySelectedPath"
      @trash-selection="contextTrashSelection"
      @copy-selection-paths="copySelectionPaths"
      @clear-selection="clearSelection"
    />

    <MimContextMenu
      v-if="emptyMenuPos"
      :x="emptyMenuPos.x"
      :y="emptyMenuPos.y"
      :width="172"
      :height="94"
      panel-class="border-rule-light py-1 font-sans text-[12px] text-ink-2"
      @close="emptyMenuPos = null"
    >
      <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="promptNewFile()">
        New file
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="promptNewFolder()">
        New folder
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emptyMenuPos = null; void refresh()">
        Refresh
      </MimMenuItem>
    </MimContextMenu>

    <MimDialog
      v-if="nameAction"
      :open="true"
      size="sm"
      :title="nameDialogTitle"
      @close="closeNameDialog"
    >
      <form class="flex flex-col gap-3 px-5 pb-5" @submit.prevent="confirmNameAction">
        <input
          v-model="nameInput"
          type="text"
          autofocus
          spellcheck="false"
          autocomplete="off"
          class="w-full rounded-[6px] border border-rule-light bg-surface px-[10px] font-mono text-[12px] text-ink outline-none placeholder:text-ink-4 focus:border-accent h-[30px]"
          :placeholder="nameAction.kind === 'new-folder' ? 'folder-name' : 'file-name.md'"
        >
        <p v-if="nameError" class="m-0 font-sans text-[12px] text-rem">{{ nameError }}</p>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 font-sans text-[12px] text-ink-2 hover:bg-chrome-mid"
            @click="closeNameDialog"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="h-7 rounded-[5px] bg-accent px-3 font-sans text-[12px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            :disabled="nameBusy"
          >
            {{ nameDialogConfirmLabel }}
          </button>
        </div>
      </form>
    </MimDialog>

    <MimDialog
      v-if="deleteTarget"
      :open="true"
      size="sm"
      role="alertdialog"
      :title="deleteDialogLabel"
      @close="closeDeleteDialog"
    >
      <div class="flex flex-col gap-3 px-5 pb-5 font-sans">
        <p class="m-0 text-[13px] text-ink">
          Delete
          <span class="font-semibold">{{
            deleteTarget.items.length > 1
              ? `${deleteTarget.items.length} items`
              : baseName(deleteTarget.items[0].path)
          }}</span>?
        </p>
        <p class="m-0 text-[12px] text-ink-3">
          {{ deleteTarget.items.length > 1
            ? 'They move to the Trash. You can put them back from there.'
            : 'It moves to the Trash. You can put it back from there.' }}
        </p>
        <p v-if="deleteError" class="m-0 text-[12px] text-rem">{{ deleteError }}</p>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
            @click="closeDeleteDialog"
          >
            Cancel
          </button>
          <button
            type="button"
            class="h-7 rounded-[5px] bg-rem px-3 text-[12px] font-medium text-accent-ink hover:opacity-90 disabled:opacity-50"
            :disabled="deleteBusy"
            @click="confirmDelete"
          >
            {{ deleteDialogLabel }}
          </button>
        </div>
      </div>
    </MimDialog>
  </section>
</template>
