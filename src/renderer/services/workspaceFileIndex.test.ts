import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceFileIndex } from './workspaceFileIndex.js'

function stubKernel(call: (tool: string, params?: Record<string, unknown>) => unknown) {
  vi.stubGlobal('window', { kernel: { call: vi.fn(call) } })
}

const BASE_ENTRIES = [
  { name: 'index.ts', path: 'src/index.ts', type: 'file' },
  { name: 'src', path: 'src', type: 'directory' },
]

const TEAM_ENTRIES = [
  { name: 'logo.svg', path: '.mim/team/files/logo.svg', type: 'file' },
]

describe('workspaceFileIndex with Team Files', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges writable Team files and tags them with Team provenance', async () => {
    stubKernel((tool, params) => {
      if (tool === 'fs.list' && !params?.path) return { entries: BASE_ENTRIES, truncated: false }
      if (tool === 'fs.list' && params?.path === '.mim/team/files') {
        return { entries: TEAM_ENTRIES, truncated: false }
      }
      throw new Error(`Unexpected tool: ${tool} ${JSON.stringify(params)}`)
    })

    const { files, refresh } = useWorkspaceFileIndex()
    await refresh()

    const paths = files.value.map(f => f.path)
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('.mim/team/files/logo.svg')
    expect(files.value.find(f => f.path === '.mim/team/files/logo.svg')?.source).toBe('team')
  })

  it('still indexes the Project when optional Team Files are unavailable', async () => {
    stubKernel((tool, params) => {
      if (tool === 'fs.list' && !params?.path) return { entries: BASE_ENTRIES, truncated: false }
      if (tool === 'fs.list' && params?.path === '.mim/team/files') throw new Error('No Team files')
      throw new Error(`Unexpected tool: ${tool}`)
    })

    const { files, refresh } = useWorkspaceFileIndex()
    await refresh()
    expect(files.value.map(f => f.path)).toContain('src/index.ts')
  })
})
