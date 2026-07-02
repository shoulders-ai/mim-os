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
    expect(JSON.parse(transfer.getData(WORKSPACE_DRAG_MIME))).toEqual({ path: 'README.md', type: 'file' })

    const over = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(over, 'dataTransfer', { value: transfer })
    rows[1].dispatchEvent(over)

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    Object.defineProperty(drop, 'dataTransfer', { value: transfer })
    rows[1].dispatchEvent(drop)

    expect(moved).toEqual([{ source: { path: 'README.md', type: 'file' }, targetDir: 'docs' }])
  })
})
