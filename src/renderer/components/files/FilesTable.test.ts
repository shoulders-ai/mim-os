// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
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

function mountRows(rows: FileRow[]) {
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
  })
  app.mount(appRoot)
  return { app, root: appRoot }
}

function nameCells(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-testid="files-row"] > span:first-child'))
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
})
