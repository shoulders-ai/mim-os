import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceFileIndex } from './workspaceFileIndex.js'

function stubKernel(call: (tool: string, params?: Record<string, unknown>) => unknown) {
  vi.stubGlobal('window', { kernel: { call: vi.fn(call) } })
}

const BASE_ENTRIES = [
  { name: 'index.ts', path: 'src/index.ts', type: 'file' },
  { name: 'src', path: 'src', type: 'directory' },
]

const MOUNT_ENTRIES = [
  { name: 'logo.svg', path: '.mim/resources/designs/logo.svg', type: 'file' },
]

describe('workspaceFileIndex with resource mounts', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges files from ok mounts and tags them with the collection id', async () => {
    stubKernel((tool, params) => {
      if (tool === 'fs.list' && !params?.path) return { entries: BASE_ENTRIES, truncated: false }
      if (tool === 'fs.list' && params?.path === '.mim/resources/designs') {
        return { entries: MOUNT_ENTRIES, truncated: false }
      }
      if (tool === 'resources.collections') {
        return { collections: [
          { id: 'designs', status: 'ok', mountPath: '.mim/resources/designs' },
          { id: 'brand', status: 'not-synced', mountPath: '.mim/resources/brand' },
        ] }
      }
      throw new Error(`Unexpected tool: ${tool} ${JSON.stringify(params)}`)
    })

    const { files, refresh } = useWorkspaceFileIndex()
    await refresh()

    const paths = files.value.map(f => f.path)
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('.mim/resources/designs/logo.svg')
    // not-synced collection is never listed
    expect(files.value.some(f => f.collection === 'brand')).toBe(false)
    const mounted = files.value.find(f => f.path === '.mim/resources/designs/logo.svg')
    expect(mounted?.collection).toBe('designs')
  })

  it('still indexes the workspace when resources.collections fails', async () => {
    stubKernel((tool, params) => {
      if (tool === 'fs.list' && !params?.path) return { entries: BASE_ENTRIES, truncated: false }
      if (tool === 'resources.collections') throw new Error('no workspace')
      throw new Error(`Unexpected tool: ${tool}`)
    })

    const { files, refresh } = useWorkspaceFileIndex()
    await refresh()
    expect(files.value.map(f => f.path)).toContain('src/index.ts')
  })
})
