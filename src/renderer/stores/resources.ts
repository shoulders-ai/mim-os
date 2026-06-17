import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

// Mirror of the main-process publicView (src/main/tools/resources.ts). The
// renderer never touches the filesystem directly; file access inside a mount
// goes through the normal fs.* tools at mountPath. See docs/resources.md.
export type CollectionWritePolicy = 'readonly' | 'direct'
export type CollectionStatus = 'ok' | 'missing-binding' | 'missing-source' | 'not-synced'

export interface ResourceSource {
  kind: 'local_folder' | 'git_repo'
  location: string
}

export interface ResourceView {
  id: string
  name: string
  source: ResourceSource | null
  write: CollectionWritePolicy
  origin: 'workspace' | 'machine'
  status: CollectionStatus
  root: string | null
  mountPath: string
}

export interface AddFolderInput {
  path: string
  // Pass the id of a missing-binding collection to satisfy a committed
  // mim.yaml expectation on this machine.
  id?: string
  name?: string
  write?: CollectionWritePolicy
}

export interface AddGitInput {
  git: string
  name?: string
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const useResourcesStore = defineStore('resources', () => {
  const collections = ref<ResourceView[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasResources = computed(() => collections.value.length > 0)

  async function refresh(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const result = await window.kernel.call('resources.collections') as { collections: ResourceView[] }
      collections.value = result.collections ?? []
    } catch (err) {
      error.value = message(err)
    } finally {
      loading.value = false
    }
  }

  // Add helpers don't swallow errors: callers (the panel) show inline validation
  // for duplicate ids, missing folders, direct-on-git, etc.
  async function addFolder(input: AddFolderInput): Promise<void> {
    const params: Record<string, unknown> = { path: input.path }
    if (input.id) params.id = input.id
    if (input.name) params.name = input.name
    if (input.write) params.write = input.write
    await window.kernel.call('resources.add', params)
    await refresh()
  }

  async function addGit(input: AddGitInput): Promise<void> {
    const params: Record<string, unknown> = { git: input.git }
    if (input.name) params.name = input.name
    await window.kernel.call('resources.add', params)
    await refresh()
  }

  async function setPolicy(id: string, write: CollectionWritePolicy): Promise<void> {
    await window.kernel.call('resources.setPolicy', { id, write })
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await window.kernel.call('resources.remove', { id })
    await refresh()
  }

  async function sync(id?: string): Promise<void> {
    await window.kernel.call('resources.sync', id ? { id } : {})
    await refresh()
  }

  // Native directory picker (main process). Returns the absolute path or null.
  async function pickFolder(): Promise<string | null> {
    return window.kernel.openFolderDialog()
  }

  return {
    collections,
    loading,
    error,
    hasResources,
    refresh,
    addFolder,
    addGit,
    setPolicy,
    remove,
    sync,
    pickFolder,
  }
})
