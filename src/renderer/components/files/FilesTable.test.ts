// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { WORKSPACE_DRAG_MIME } from './fileMove.js'
import FilesTable from './FilesTable.vue'
import type { FileRow } from './fileTypes.js'

function row(path: string, name: string, level: number, type: 'directory' | 'file' = 'file'): FileRow {
  return {
    path,
    name,
    dir: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '',
    type,
    kind: type === 'directory' ? 'Folder' : 'Markdown',
    positions: [],
    level,
    gi: level,
  }
}

function mountRows(rows: FileRow[], listeners: Record<string, unknown> = {}) {
  const appRoot = document.createElement('div')
  document.body.appendChild(appRoot)
  const app = createApp(FilesTable, {
    rows,
    tableMode: 'browse',
    showLocationColumn: false,
    selectedIndex: -1,
    query: '',
    resourceRootCount: 0,
    emptyText: 'No files',
    directoryError: '',
    sortKey: 'name',
    sortDirection: 'asc',
    expandedPaths: new Set<string>(),
    expandedLoading: new Set<string>(),
    selectedPaths: new Set<string>(),
    activeFilePath: '',
    ...listeners,
  })
  app.mount(appRoot)
  return { app, root: appRoot }
}

function nameCells(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-testid="files-row"] > span:first-child'))
}

function dataTransfer() {
  const values = new Map<string, string>()
  const transfer = {
    types: [] as string[],
    files: [],
    effectAllowed: '',
    dropEffect: '',
    setData(type: string, value: string) {
      values.set(type, value)
      transfer.types = Array.from(values.keys())
    },
    getData(type: string) {
      return values.get(type) ?? ''
    },
  }
  return transfer
}

describe('FilesTable', () => {
  let mounted: ReturnType<typeof mountRows> | null = null

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('pins the column header to the top of the scroll pane', () => {
    mounted = mountRows([row('README.md', 'README.md', 0)])

    const header = mounted.root.querySelector<HTMLElement>('[data-testid="files-column-header"]')!
    expect(header.textContent).toContain('Name')
    expect(header.className).toContain('sticky')
    expect(header.className).toContain('top-0')
    expect(header.className).toContain('bg-surface')
  })

  it('increases indentation for every nested browse level', () => {
    mounted = mountRows([
      row('README.md', 'README.md', 0),
      row('docs', 'docs', 1, 'directory'),
      row('docs/guides', 'guides', 2, 'directory'),
      row('docs/guides/setup.md', 'setup.md', 3),
    ])

    const cells = nameCells(mounted.root)
    expect(cells[0].className).not.toMatch(/\bpl-/)
    expect(cells[1].className).toContain('pl-4')
    expect(cells[2].className).toContain('pl-8')
    expect(cells[3].className).toContain('pl-12')
  })

  it('marks the active editor file without reusing hover or selection styling', () => {
    mounted = mountRows([
      row('README.md', 'README.md', 0),
      row('docs/design-system.md', 'design-system.md', 1),
    ], {
      activeFilePath: 'docs/design-system.md',
      selectedIndex: 0,
    })

    const rows = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('[data-testid="files-row"]'))
    expect(rows[0].className).toContain('bg-accent-tint')
    expect(rows[1].dataset.activeFile).toBe('true')
    expect(rows[1].className).not.toContain('bg-accent-tint')
    expect(rows[1].className).not.toMatch(/(?:^|\s)bg-chrome-high(?:\s|$)/)
    expect(rows[1].className).toContain('hover:bg-chrome-high')
    expect(rows[1].querySelector('[data-testid="files-row-kind-icon"]')?.className).toContain('text-accent')
    expect(rows[1].querySelector('[data-testid="files-row-name"]')?.className).toContain('font-[650]')
  })

  it('emits workspace moves when a row is dragged onto a folder row', async () => {
    const moved: Array<{ source: unknown; targetDir: string | null }> = []
    mounted = mountRows([
      row('README.md', 'README.md', 0),
      row('docs', 'docs', 1, 'directory'),
    ], {
      onDropWorkspace: (source: unknown, targetDir: string | null) => moved.push({ source, targetDir }),
    })

    const rows = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('[data-testid="files-row"]'))
    const transfer = dataTransfer()
    const start = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(start, 'dataTransfer', { value: transfer })
    rows[0].dispatchEvent(start)

    expect(transfer.effectAllowed).toBe('move')
    expect(JSON.parse(transfer.getData(WORKSPACE_DRAG_MIME))).toEqual({
      items: [{ path: 'README.md', type: 'file' }],
    })

    const over = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(over, 'dataTransfer', { value: transfer })
    rows[1].dispatchEvent(over)

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(drop, 'dataTransfer', { value: transfer })
    rows[1].dispatchEvent(drop)

    expect(moved).toEqual([{
      source: { items: [{ path: 'README.md', type: 'file' }] },
      targetDir: 'docs',
    }])
  })

  it('highlights multi-selected rows persistently', () => {
    mounted = mountRows([
      row('a.md', 'a.md', 0),
      row('b.md', 'b.md', 0),
      row('c.md', 'c.md', 0),
    ], {
      selectedPaths: new Set(['a.md', 'c.md']),
    })

    const rows = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('[data-testid="files-row"]'))
    expect(rows[0].dataset.selected).toBe('true')
    expect(rows[0].className).toContain('bg-accent-tint')
    expect(rows[1].dataset.selected).toBeUndefined()
    expect(rows[1].className).not.toContain('bg-accent-tint')
    expect(rows[2].dataset.selected).toBe('true')
  })

  it('forwards the mouse event with row clicks so modifiers reach the parent', () => {
    const clicks: Array<{ path: string; meta: boolean; shift: boolean }> = []
    mounted = mountRows([row('a.md', 'a.md', 0)], {
      onRowClick: (clicked: FileRow, event: MouseEvent) =>
        clicks.push({ path: clicked.path, meta: event.metaKey, shift: event.shiftKey }),
    })

    const rowEl = mounted.root.querySelector<HTMLButtonElement>('[data-testid="files-row"]')!
    rowEl.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    rowEl.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))

    expect(clicks).toEqual([
      { path: 'a.md', meta: true, shift: false },
      { path: 'a.md', meta: false, shift: true },
    ])
  })

  it('drags the whole selection when a selected row is dragged', () => {
    mounted = mountRows([
      row('a.md', 'a.md', 0),
      row('b.md', 'b.md', 0),
      row('c.md', 'c.md', 0),
    ], {
      selectedPaths: new Set(['a.md', 'c.md']),
    })

    const rows = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('[data-testid="files-row"]'))
    const transfer = dataTransfer()
    const start = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(start, 'dataTransfer', { value: transfer })
    rows[0].dispatchEvent(start)

    expect(JSON.parse(transfer.getData(WORKSPACE_DRAG_MIME))).toEqual({
      items: [
        { path: 'a.md', type: 'file' },
        { path: 'c.md', type: 'file' },
      ],
    })
  })

  it('drags only the grabbed row when it is outside the selection', () => {
    mounted = mountRows([
      row('a.md', 'a.md', 0),
      row('b.md', 'b.md', 0),
    ], {
      selectedPaths: new Set(['a.md']),
    })

    const rows = Array.from(mounted.root.querySelectorAll<HTMLButtonElement>('[data-testid="files-row"]'))
    const transfer = dataTransfer()
    const start = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(start, 'dataTransfer', { value: transfer })
    rows[1].dispatchEvent(start)

    expect(JSON.parse(transfer.getData(WORKSPACE_DRAG_MIME))).toEqual({
      items: [{ path: 'b.md', type: 'file' }],
    })
  })
})
