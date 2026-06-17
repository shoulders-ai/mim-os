// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

vi.mock('ag-grid-community', () => ({
  AllCommunityModule: {},
  ModuleRegistry: { registerModules: vi.fn() },
  themeQuartz: { withParams: vi.fn((params: Record<string, unknown>) => ({ params })) },
}))

vi.mock('ag-grid-vue3', () => ({
  AgGridVue: defineComponent({
    name: 'AgGridVueStub',
    props: ['rowData', 'columnDefs', 'defaultColDef', 'theme'],
    emits: ['cell-value-changed'],
    setup(props, { emit }) {
      return () => {
        const columns = props.columnDefs as any[] | undefined
        const defaultColDef = props.defaultColDef as any
        const rowNumberColumn = columns?.[0]
        const numericClass = typeof defaultColDef?.cellClass === 'function'
          ? defaultColDef.cellClass({ value: '42' })
          : ''
        const textClass = typeof defaultColDef?.cellClass === 'function'
          ? defaultColDef.cellClass({ value: 'Ada' })
          : ''
        const rowNumberValue = typeof rowNumberColumn?.valueGetter === 'function'
          ? rowNumberColumn.valueGetter({ data: { __rowIndex: 0 }, node: { rowIndex: 9 } })
          : ''
        const theme = props.theme as { params?: Record<string, unknown> } | undefined
        return h('button', {
          'data-testid': 'edit-cell',
          'data-filter-enabled': String(defaultColDef?.filter),
          'data-row-number-col': String(rowNumberColumn?.colId ?? ''),
          'data-row-number-value': String(rowNumberValue),
          'data-number-class': String(numericClass),
          'data-text-class': String(textClass),
          'data-hover-color': String(theme?.params?.rowHoverColor ?? ''),
          onClick: () => emit('cell-value-changed', {
            colDef: { field: 'c1' },
            column: { getColId: () => 'c1' },
            data: { __rowIndex: 0 },
            newValue: '11',
          }),
        }, `grid:${props.rowData?.length ?? 0}:${columns?.length ?? 0}`)
      }
    },
  }),
}))

const { default: TableArtifact } = await import('./TableArtifact.vue')

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function mountTable(path: string, handlers: Record<string, unknown> = {}) {
  const tableRef = ref<any>(null)
  const appRoot = document.createElement('div')
  document.body.appendChild(appRoot)
  const app = createApp({
    setup() {
      return () => h(TableArtifact, { ref: tableRef, path, ...handlers })
    },
  })
  app.mount(appRoot)
  return { app, root: appRoot, tableRef }
}

describe('TableArtifact', () => {
  let mounted: ReturnType<typeof mountTable> | null = null
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    call = vi.fn(async (tool: string, params: Record<string, unknown> = {}) => {
      if (tool === 'fs.read') {
        expect(params).toEqual({ path: 'data/scores.csv', full: true })
        return {
          content: 'Name,Score\nAda,10\n',
          version: { hash: 'hash:initial', size: 18, mtimeMs: 100 },
        }
      }
      throw new Error(`Unexpected kernel call ${tool}`)
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call },
    })
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.restoreAllMocks()
  })

  it('loads a CSV as a grid and exposes serialization, stats, and dirty state', async () => {
    const dirtyEvents: boolean[] = []
    const statEvents: Array<{ rows: number; cols: number }> = []
    const loadedEvents: Array<{ content: string; version?: { hash: string } }> = []
    mounted = mountTable('data/scores.csv', {
      'onUpdate:dirty': (value: boolean) => dirtyEvents.push(value),
      'onUpdate:stats': (value: { rows: number; cols: number }) => statEvents.push(value),
      onLoaded: (value: { content: string; version?: { hash: string } }) => loadedEvents.push(value),
    })
    await flushUi()

    const grid = mounted.root.querySelector<HTMLElement>('[data-testid="edit-cell"]')
    expect(mounted.root.textContent).toContain('grid:1:3')
    expect(grid?.getAttribute('data-filter-enabled')).toBe('true')
    expect(grid?.getAttribute('data-row-number-col')).toBe('__rowNumber')
    expect(grid?.getAttribute('data-row-number-value')).toBe('2')
    expect(grid?.getAttribute('data-number-class')).toBe('table-cell-number')
    expect(grid?.getAttribute('data-text-class')).toBe('')
    expect(grid?.getAttribute('data-hover-color')).toBe('rgba(192,93,60,0.06)')
    expect(mounted.tableRef.value.serialize()).toBe('Name,Score\nAda,10\n')
    expect(statEvents.at(-1)).toEqual({ rows: 1, cols: 2 })
    expect(loadedEvents.at(-1)).toEqual({
      content: 'Name,Score\nAda,10\n',
      version: { hash: 'hash:initial', size: 18, mtimeMs: 100, modifiedAt: undefined },
    })

    mounted.root.querySelector<HTMLButtonElement>('[data-testid="edit-cell"]')?.click()
    await flushUi()

    expect(dirtyEvents.at(-1)).toBe(true)
    expect(mounted.tableRef.value.serialize()).toBe('Name,Score\nAda,11\n')

    mounted.tableRef.value.markSaved('Name,Score\nAda,11\n', { hash: 'hash:saved' })
    await flushUi()

    expect(dirtyEvents.at(-1)).toBe(false)
  })
})
