import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_DRAG_MIME,
  buildWorkspaceMovePlan,
  encodeWorkspaceDragPayload,
  isWorkspaceDragRow,
  isWorkspaceDropDir,
  parseWorkspaceDragPayload,
  pruneNestedDragItems,
} from './fileMove.js'
import type { FileRow } from './fileTypes.js'

function row(path: string, type: 'directory' | 'file' = 'file', extra: Partial<FileRow> = {}): FileRow {
  return {
    path,
    name: path.split('/').pop() ?? path,
    dir: '',
    type,
    kind: type === 'directory' ? 'Folder' : 'Markdown',
    positions: [],
    level: 0,
    gi: 0,
    ...extra,
  }
}

describe('fileMove', () => {
  it('serializes a multi-item workspace drag payload', () => {
    const encoded = encodeWorkspaceDragPayload([
      { path: 'README.md', type: 'file' },
      { path: 'docs', type: 'directory' },
    ])

    expect(WORKSPACE_DRAG_MIME).toContain('mim')
    expect(parseWorkspaceDragPayload(encoded)).toEqual({
      items: [
        { path: 'README.md', type: 'file' },
        { path: 'docs', type: 'directory' },
      ],
    })
    expect(parseWorkspaceDragPayload('nope')).toBeNull()
    expect(parseWorkspaceDragPayload('{"items":[]}')).toBeNull()
    expect(parseWorkspaceDragPayload('{"items":[{"path":1,"type":"file"}]}')).toBeNull()
  })

  it('prunes items nested under a dragged directory so moves never double-apply', () => {
    expect(pruneNestedDragItems([
      { path: 'docs', type: 'directory' },
      { path: 'docs/a.md', type: 'file' },
      { path: 'docs/nested', type: 'directory' },
      { path: 'docs-notes.md', type: 'file' },
      { path: 'README.md', type: 'file' },
    ])).toEqual([
      { path: 'docs', type: 'directory' },
      { path: 'docs-notes.md', type: 'file' },
      { path: 'README.md', type: 'file' },
    ])
  })

  it('builds a move target without changing the basename', () => {
    expect(buildWorkspaceMovePlan({ path: 'README.md', type: 'file' }, 'docs')).toEqual({
      ok: true,
      move: { oldPath: 'README.md', newPath: 'docs/README.md', type: 'file' },
    })
  })

  it('rejects no-op and recursive folder moves before touching disk', () => {
    expect(buildWorkspaceMovePlan({ path: 'docs/a.md', type: 'file' }, 'docs')).toMatchObject({
      ok: false,
      reason: 'Already in this folder.',
    })
    expect(buildWorkspaceMovePlan({ path: 'docs', type: 'directory' }, 'docs/nested')).toMatchObject({
      ok: false,
      reason: 'A folder cannot be moved into itself.',
    })
  })

  it('allows moves within and across the writable Team Files root', () => {
    expect(isWorkspaceDragRow(row('.mim/team/files/a.md'))).toBe(true)
    expect(isWorkspaceDropDir(row('.mim/team/files', 'directory'))).toBe(true)
    expect(buildWorkspaceMovePlan({ path: '.mim/team/files/a.md', type: 'file' }, '.')).toMatchObject({ ok: true })
    expect(buildWorkspaceMovePlan({ path: 'README.md', type: 'file' }, '.mim/team/files')).toEqual({
      ok: true,
      move: {
        oldPath: 'README.md',
        newPath: '.mim/team/files/README.md',
        type: 'file',
      },
    })
  })

  it('keeps Team infrastructure and other managed Mim paths out of manual moves', () => {
    expect(isWorkspaceDragRow(row('.mim/team/files', 'directory'))).toBe(false)
    expect(isWorkspaceDragRow(row('.mim/team/team.yaml'))).toBe(false)
    expect(isWorkspaceDropDir(row('.mim/packages', 'directory'))).toBe(false)
  })

  it('allows normal workspace files and directories', () => {
    expect(isWorkspaceDragRow(row('README.md'))).toBe(true)
    expect(isWorkspaceDropDir(row('docs', 'directory'))).toBe(true)
    expect(isWorkspaceDropDir(row('README.md'))).toBe(false)
    expect(isWorkspaceDropDir(row('docs', 'directory', { disabled: true }))).toBe(false)
  })
})
