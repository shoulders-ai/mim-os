// A cached, recursive index of the workspace's files, used by the Files Work
// surface's fuzzy file search. The cache is module-level so reopening Files is
// instant; `load()` refreshes it in the background when warm.

import { ref } from 'vue'

export interface IndexedFile {
  /** Workspace-relative path, e.g. "src/main/index.ts". */
  path: string
  /** Basename, e.g. "index.ts". */
  name: string
  /** Parent dir relative to the workspace, e.g. "src/main" ("" at the root). */
  dir: string
  /** File byte size, when provided by the kernel. */
  size?: number
  /** ISO timestamp from the filesystem modified time. */
  modifiedAt?: string
  /** ISO timestamp from the filesystem birth/created time. */
  createdAt?: string
  /** Best-effort git author for the most recent change, when requested. */
  lastChangedBy?: string
  /** Set when the file lives inside a mounted resource collection. */
  collection?: string
}

// fs.list caps results; surface the cap so the UI never silently truncates.
const MAX_FILES = 1000

const files = ref<IndexedFile[]>([])
const truncated = ref(false)
const loaded = ref(false)
let inFlight: Promise<void> | null = null

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

interface ListResult {
  entries?: Array<{
    name: string
    path: string
    type: string
    size?: number
    modifiedAt?: string
    createdAt?: string
    lastChangedBy?: string
  }>
  truncated?: boolean
}

function toIndexed(result: ListResult, collection?: string): IndexedFile[] {
  return (result.entries ?? [])
    .filter(e => e.type === 'file')
    .map(e => ({
      path: e.path,
      name: e.name,
      dir: dirOf(e.path),
      size: e.size,
      modifiedAt: e.modifiedAt,
      createdAt: e.createdAt,
      lastChangedBy: e.lastChangedBy,
      collection,
    }))
}

async function listDir(path: string | undefined, max: number): Promise<ListResult> {
  return await window.kernel.call('fs.list', {
    ...(path ? { path } : {}),
    recursive: true,
    max_entries: max,
  }) as ListResult
}

// fs.list skips .mim and never follows symlinks, so mounted resource
// collections (symlinks under .mim/resources/<id>) are invisible to the base
// walk. List each ok mount explicitly so its files are @-mentionable and
// searchable in the Files surface. See docs/resources.md.
async function fetchMountFiles(budget: number): Promise<{ files: IndexedFile[]; truncated: boolean }> {
  if (budget <= 0) return { files: [], truncated: true }
  let collections: Array<{ id: string; status: string; mountPath: string }> = []
  try {
    const result = await window.kernel.call('resources.collections') as {
      collections?: Array<{ id: string; status: string; mountPath: string }>
    }
    collections = result.collections ?? []
  } catch {
    return { files: [], truncated: false }
  }

  const out: IndexedFile[] = []
  let isTruncated = false
  for (const c of collections) {
    if (c.status !== 'ok') continue
    const remaining = budget - out.length
    if (remaining <= 0) { isTruncated = true; break }
    try {
      const listed = await listDir(c.mountPath, remaining)
      out.push(...toIndexed(listed, c.id))
      if (listed.truncated) isTruncated = true
    } catch {
      // a single bad mount must not break the whole index
    }
  }
  return { files: out, truncated: isTruncated }
}

async function fetchIndex(): Promise<void> {
  const base = await listDir(undefined, MAX_FILES)
  const baseFiles = toIndexed(base)

  const mounts = await fetchMountFiles(MAX_FILES - baseFiles.length)

  files.value = [...baseFiles, ...mounts.files]
  truncated.value = !!base.truncated || mounts.truncated
  loaded.value = true
}

export function useWorkspaceFileIndex() {
  // Returns immediately if the cache is warm (refreshing in the background),
  // otherwise awaits the first fetch.
  async function load(): Promise<void> {
    if (loaded.value) {
      void refresh()
      return
    }
    if (!inFlight) inFlight = fetchIndex().finally(() => { inFlight = null })
    await inFlight
  }

  async function refresh(): Promise<void> {
    try {
      await fetchIndex()
    } catch (err) {
      console.error('Failed to refresh workspace file index:', err)
    }
  }

  return { files, truncated, loaded, load, refresh }
}
