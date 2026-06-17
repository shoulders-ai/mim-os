<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { AgGridVue } from 'ag-grid-vue3'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellKeyDownEvent,
  type CellValueChangedEvent,
  type ColDef,
} from 'ag-grid-community'
import {
  extractFileVersion,
  fieldToColumnIndex,
  parseDelimitedTable,
  rowsToRecords,
  serializeDelimitedTable,
  setCellValue,
  tableStats,
  type FileVersion,
  type TableModel,
  type TableRowRecord,
  type TableStats,
} from './tableArtifactModel.js'

ModuleRegistry.registerModules([AllCommunityModule])

const props = defineProps<{
  path: string
}>()

const emit = defineEmits<{
  'update:dirty': [dirty: boolean]
  'update:stats': [stats: TableStats]
  loaded: [payload: { content: string; version?: FileVersion }]
}>()

const loading = ref(false)
const loadError = ref('')
const model = ref<TableModel | null>(null)
const fileVersion = ref<FileVersion | undefined>(undefined)
const dirty = ref(false)
const stats = ref<TableStats>({ rows: 0, cols: 0 })
const rowData = ref<TableRowRecord[]>([])
const columnDefs = ref<ColDef<TableRowRecord>[]>([])
const gridTheme = shallowRef(createGridTheme())
let loadToken = 0
let themeObserver: MutationObserver | null = null

const defaultColDef: ColDef<TableRowRecord> = {
  editable: true,
  sortable: true,
  resizable: true,
  filter: true,
  minWidth: 88,
  cellDataType: false,
  cellClass: numericCellClass,
}

const autoSizeStrategy = {
  type: 'fitCellContents' as const,
  skipHeader: false,
}

const rowSelection = {
  mode: 'singleRow' as const,
  enableClickSelection: true,
  checkboxes: false,
}

const hasTable = computed(() => Boolean(model.value && stats.value.cols > 0))
const isEmpty = computed(() => !loading.value && !loadError.value && model.value && stats.value.cols === 0)

watch(() => props.path, () => { void load() }, { immediate: true })

async function load() {
  const token = ++loadToken
  loading.value = true
  loadError.value = ''
  model.value = null
  fileVersion.value = undefined
  rowData.value = []
  columnDefs.value = []
  setDirty(false)
  updateStats({ rows: 0, cols: 0 })

  try {
    const result = await window.kernel.call('fs.read', { path: props.path, full: true }) as {
      content?: string
      truncated?: boolean
    }
    if (token !== loadToken) return
    if (result.truncated === true) {
      throw new Error('Table file was truncated while reading. Save is blocked.')
    }
    const content = typeof result.content === 'string' ? result.content : ''
    const parsed = parseDelimitedTable(content, props.path)
    model.value = parsed
    fileVersion.value = extractFileVersion(result)
    rowData.value = rowsToRecords(parsed)
    columnDefs.value = [
      rowNumberColumn(),
      ...parsed.columns.map(column => ({
        field: column.id,
        colId: column.id,
        headerName: column.label,
        headerTooltip: column.rawHeader || column.label,
        tooltipField: column.id,
      })),
    ]
    updateStats(tableStats(parsed))
    emit('loaded', { content: parsed.originalSerialized, version: fileVersion.value })
    setDirty(false)
    if (parsed.errors.length > 0 && parsed.rows.length === 0) {
      loadError.value = parsed.errors[0] ?? 'Could not parse table.'
    }
  } catch (err) {
    if (token !== loadToken) return
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function serialize(): string {
  if (!model.value) return ''
  return serializeDelimitedTable(model.value)
}

function markSaved(content: string, version?: FileVersion) {
  if (!model.value) return
  model.value.originalSerialized = content
  fileVersion.value = version
  setDirty(false)
}

function onCellValueChanged(event: CellValueChangedEvent<TableRowRecord>) {
  const current = model.value
  if (!current) return
  const field = event.colDef.field ?? event.column?.getColId?.()
  const columnIndex = fieldToColumnIndex(field)
  const dataRowIndex = typeof event.data?.__rowIndex === 'number' ? event.data.__rowIndex : null
  if (columnIndex == null || dataRowIndex == null) return
  setCellValue(current, dataRowIndex, columnIndex, event.newValue == null ? '' : String(event.newValue))
  setDirty(true)
}

function onCellKeyDown(event: CellKeyDownEvent<TableRowRecord>) {
  const keyboardEvent = event.event as KeyboardEvent | undefined
  if (!keyboardEvent || !(keyboardEvent.metaKey || keyboardEvent.ctrlKey)) return
  if (keyboardEvent.key.toLowerCase() !== 'c') return
  const value = event.value == null ? '' : String(event.value)
  void navigator.clipboard?.writeText(value).catch(() => {})
  keyboardEvent.preventDefault()
  keyboardEvent.stopPropagation()
}

function setDirty(next: boolean) {
  dirty.value = next
  emit('update:dirty', next)
}

function updateStats(next: TableStats) {
  stats.value = next
  emit('update:stats', next)
}

function rowNumberColumn(): ColDef<TableRowRecord> {
  return {
    colId: '__rowNumber',
    headerName: '',
    width: 56,
    minWidth: 56,
    maxWidth: 56,
    editable: false,
    sortable: false,
    resizable: false,
    filter: false,
    suppressHeaderMenuButton: true,
    lockPosition: 'left',
    valueGetter: params => typeof params.data?.__rowIndex === 'number'
      ? String(params.data.__rowIndex + 2)
      : '',
    cellClass: 'table-row-number',
    headerClass: 'table-row-number-header',
  }
}

function numericCellClass(params: { value: unknown }): string {
  const value = params.value
  if (value == null) return ''
  const text = String(value).trim()
  if (!text) return ''
  return Number.isFinite(Number(text)) ? 'table-cell-number' : ''
}

function refreshTheme() {
  gridTheme.value = createGridTheme()
}

function createGridTheme() {
  const style = typeof window === 'undefined'
    ? null
    : window.getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => {
    const value = style?.getPropertyValue(name).trim()
    return value || fallback
  }
  const surface = token('--color-surface', '#ffffff')
  const ink = token('--color-ink', '#1a1a18')
  const ink2 = token('--color-ink-2', '#4a4a44')
  const ink3 = token('--color-ink-3', '#8a8a80')
  const chromeHigh = token('--color-chrome-high', '#f9f8f5')
  const ruleLight = token('--color-rule-light', '#eae9e5')
  const lineHighlight = token('--color-line-hl', 'rgba(192,93,60,0.06)')
  const accent = token('--color-accent', '#c05d3c')
  const accentTint = token('--color-accent-tint', 'rgba(192,93,60,0.06)')
  const fontSans = token('--font-sans', 'Inter, -apple-system, BlinkMacSystemFont, sans-serif')

  return themeQuartz.withParams({
    backgroundColor: surface,
    foregroundColor: ink,
    textColor: ink,
    subtleTextColor: ink3,
    chromeBackgroundColor: chromeHigh,
    headerBackgroundColor: chromeHigh,
    headerTextColor: ink2,
    borderColor: ruleLight,
    wrapperBackgroundColor: surface,
    wrapperBorder: false,
    wrapperBorderRadius: 0,
    rowBorder: { color: ruleLight },
    columnBorder: { color: ruleLight },
    headerRowBorder: { color: ruleLight },
    headerColumnBorder: { color: ruleLight },
    rowHoverColor: lineHighlight,
    oddRowBackgroundColor: 'transparent',
    selectedRowBackgroundColor: accentTint,
    accentColor: accent,
    cellEditingBorder: { color: accent, width: 1 },
    rangeSelectionBorderColor: accent,
    fontFamily: fontSans,
    fontSize: '12px',
    dataFontSize: '12px',
    cellFontFamily: fontSans,
    cellFontSize: '12px',
    headerFontFamily: fontSans,
    headerFontSize: '11px',
    headerFontWeight: 600,
    rowHeight: 32,
    headerHeight: 34,
    spacing: 4,
  })
}

onMounted(() => {
  refreshTheme()
  themeObserver = new MutationObserver(refreshTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
})

defineExpose({
  serialize,
  markSaved,
  reload: load,
  stats,
  version: fileVersion,
})
</script>

<template>
  <div class="flex h-full min-w-0 flex-1 flex-col bg-surface font-sans" data-testid="table-artifact">
    <div v-if="loading" class="flex h-full items-center justify-center text-[12px] text-ink-4">
      Loading table
    </div>
    <div v-else-if="loadError" class="flex h-full items-center justify-center px-6 text-center text-[12px] text-ink-4">
      {{ loadError }}
    </div>
    <div v-else-if="isEmpty" class="flex h-full items-center justify-center text-[12px] text-ink-4">
      Empty file
    </div>
    <AgGridVue
      v-else-if="hasTable"
      class="h-full w-full min-w-0 flex-1"
      :theme="gridTheme"
      :row-data="rowData"
      :column-defs="columnDefs"
      :default-col-def="defaultColDef"
      :auto-size-strategy="autoSizeStrategy"
      :row-selection="rowSelection"
      :animate-rows="false"
      :suppress-movable-columns="true"
      :suppress-cell-focus="false"
      :stop-editing-when-cells-lose-focus="true"
      @cell-value-changed="onCellValueChanged"
      @cell-key-down="onCellKeyDown"
    />
  </div>
</template>

<style scoped>
:deep(.ag-root-wrapper) {
  border: 0;
}

:deep(.ag-header-cell),
:deep(.ag-cell),
:deep(.ag-row),
:deep(.ag-root-wrapper),
:deep(.ag-icon),
:deep(.ag-cell-label-container) {
  cursor: default;
}

:deep(.ag-header-cell-label) {
  letter-spacing: 0;
}

:deep(.ag-header-cell:not(.table-row-number-header):hover) {
  background: var(--color-line-hl);
}

:deep(.table-cell-number) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

:deep(.table-row-number),
:deep(.table-row-number-header) {
  background: var(--color-chrome-high);
  color: var(--color-ink-4);
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

:deep(.ag-header-cell-resize) {
  width: 8px;
  right: -4px;
}

:deep(.ag-header-cell-resize::after) {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 3px;
  width: 1px;
  background: transparent;
}

:deep(.ag-header-cell:hover .ag-header-cell-resize::after) {
  background: var(--color-accent);
  opacity: 0.45;
}

:deep(.ag-cell-focus:not(.ag-cell-range-selected):focus-within),
:deep(.ag-cell-focus:not(.ag-cell-range-selected)) {
  border-color: var(--color-accent);
}

:deep(.ag-cell-inline-editing) {
  box-shadow: inset 0 0 0 1px var(--color-accent);
}
</style>
