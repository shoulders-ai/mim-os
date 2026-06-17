<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  IconChevronDown,
  IconDownload,
  IconFolder,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-vue'
import MimDialog from '../ui/MimDialog.vue'
import MimMenu from '../ui/MimMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import MimToggle from '../ui/MimToggle.vue'

type SkillSource = 'builtin' | 'personal' | 'source' | 'workspace'

interface SkillMetadata {
  id: string
  name: string
  description: string
  tools: string[]
  unlocks: string[]
  source: SkillSource
  sourceId?: string
  sourceName?: string
  dir: string
  path: string
  enabled: boolean
  shadows?: SkillMetadata[]
}

interface SkillDiagnostic {
  name: string
  source: SkillSource
  sourceId?: string
  path: string
  message: string
}

interface SkillSourceItem {
  id: string
  name?: string
  kind: 'path' | 'git'
  location: string
  trusted: boolean
  status?: string
  skillCount?: number
  unlocks?: string[]
  diagnostics?: string[]
}

interface SkillReview {
  skill: SkillMetadata
  unlocks?: string[]
  diagnostics?: string[]
  destination?: string
  collision?: boolean
}

interface SourceReview {
  id: string
  name?: string
  kind: 'path' | 'git'
  location: string
  skillCount: number
  skills?: SkillMetadata[]
  unlocks?: string[]
  diagnostics?: string[]
}

interface SkillGroup {
  key: string
  label: string
  source?: SkillSource
  sourceId?: string
  sourceItem?: SkillSourceItem
  items: SkillMetadata[]
}

const SOURCE_LABELS: Record<SkillSource, string> = {
  workspace: 'Workspace',
  personal: 'Personal',
  source: 'Source',
  builtin: 'Built-in',
}

const loading = ref(false)
const error = ref<string | null>(null)
const actionBusy = ref<string | null>(null)
const skills = ref<SkillMetadata[]>([])
const diagnostics = ref<SkillDiagnostic[]>([])
const sources = ref<SkillSourceItem[]>([])
const activeDialog = ref<null | 'new' | 'import' | 'source'>(null)
const confirmingDelete = ref<string | null>(null)
const confirmingSourceRemove = ref<string | null>(null)

const newSkillName = ref('')
const newSkillDescription = ref('')

const importFolder = ref('')
const importReview = ref<SkillReview | null>(null)

const sourceLocation = ref('')
const sourceId = ref('')
const sourceName = ref('')
const sourceReview = ref<SourceReview | null>(null)

const personalSkills = computed(() => skills.value.filter(skill => skill.source === 'personal'))
const sourceSkills = computed(() => skills.value.filter(skill => skill.source === 'source'))
const workspaceSkills = computed(() => skills.value.filter(skill => skill.source === 'workspace'))
const builtinSkills = computed(() => skills.value.filter(skill => skill.source === 'builtin'))

const groupedSkills = computed<SkillGroup[]>(() => {
  const groups: SkillGroup[] = []
  if (personalSkills.value.length) {
    groups.push({ key: 'personal', label: 'Personal', source: 'personal', items: personalSkills.value })
  }

  const sourceItems = sources.value.length
    ? sources.value
    : uniqueSourceGroups(sourceSkills.value)
  for (const source of sourceItems) {
    const items = sourceSkills.value.filter(skill => skill.sourceId === source.id)
    if (!items.length && source.skillCount !== 0) continue
    groups.push({
      key: `source:${source.id}`,
      label: source.name || source.id,
      source: 'source',
      sourceId: source.id,
      sourceItem: source,
      items,
    })
  }

  if (workspaceSkills.value.length) {
    groups.push({ key: 'workspace', label: 'Workspace overrides', source: 'workspace', items: workspaceSkills.value })
  }
  if (builtinSkills.value.length) {
    groups.push({ key: 'builtin', label: 'Built-in', source: 'builtin', items: builtinSkills.value })
  }
  return groups
})

const canCreate = computed(() => /^[a-z0-9][a-z0-9-]{0,63}$/.test(newSkillName.value.trim()))
const canInspectImport = computed(() => importFolder.value.trim().length > 0)
const canInspectSource = computed(() => sourceLocation.value.trim().length > 0)

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const [skillResult, sourceResult] = await Promise.all([
      window.kernel.call('skill.list', { detailed: true }),
      window.kernel.call('skillSource.list', {}),
    ])
    const skillPayload = skillResult as { skills?: SkillMetadata[]; diagnostics?: SkillDiagnostic[] }
    const sourcePayload = sourceResult as { sources?: SkillSourceItem[] }
    skills.value = skillPayload.skills ?? []
    diagnostics.value = skillPayload.diagnostics ?? []
    sources.value = sourcePayload.sources ?? []
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function uniqueSourceGroups(items: SkillMetadata[]): SkillSourceItem[] {
  const map = new Map<string, SkillSourceItem>()
  for (const skill of items) {
    const id = skill.sourceId || 'source'
    if (!map.has(id)) {
      map.set(id, {
        id,
        name: skill.sourceName || id,
        kind: 'path',
        location: skill.dir,
        trusted: true,
      })
    }
  }
  return [...map.values()]
}

function skillDiagnostics(skill: SkillMetadata) {
  return diagnostics.value.filter(diagnostic =>
    diagnostic.name === skill.name &&
    diagnostic.source === skill.source &&
    (!diagnostic.sourceId || diagnostic.sourceId === skill.sourceId),
  )
}

function sourceBadge(skill: SkillMetadata): string {
  if (skill.source === 'source') return skill.sourceName || skill.sourceId || 'Source'
  return SOURCE_LABELS[skill.source]
}

function shadowLabel(skill: SkillMetadata): string {
  return (skill.shadows ?? []).map(item => sourceBadge(item)).join(', ')
}

function chipItems(skill: SkillMetadata): Array<{ key: string; label: string; tone: string; prefix: string }> {
  return [
    ...skill.unlocks.map(name => ({
      key: `unlock:${name}`,
      label: name,
      prefix: 'Uses',
      tone: 'border-accent/30 bg-accent-soft text-accent',
    })),
    ...skill.tools
      .filter(name => !skill.unlocks.includes(name))
      .map(name => ({
        key: `tool:${name}`,
        label: name,
        prefix: 'Mentions',
        tone: 'border-rule-light bg-chrome-mid text-ink-2',
      })),
  ]
}

function sourceUnlocks(source: SkillSourceItem): string[] {
  return source.unlocks ?? []
}

function clearDialogState() {
  activeDialog.value = null
  importFolder.value = ''
  importReview.value = null
  sourceLocation.value = ''
  sourceId.value = ''
  sourceName.value = ''
  sourceReview.value = null
  newSkillName.value = ''
  newSkillDescription.value = ''
  error.value = null
}

async function toggleSkill(skill: SkillMetadata, enabled: boolean) {
  actionBusy.value = `toggle:${skill.name}`
  error.value = null
  try {
    await window.kernel.call('skill.setDisabled', { name: skill.name, disabled: !enabled })
    await refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function revealSkill(skill: SkillMetadata) {
  await window.kernel.revealInFinder(skill.dir)
}

async function editSkill(skill: SkillMetadata) {
  if (skill.source !== 'personal') return
  await window.kernel.openNativeFile(skill.path)
}

async function deleteSkill(skill: SkillMetadata) {
  if (skill.source !== 'personal') return
  if (confirmingDelete.value !== skill.name) {
    confirmingDelete.value = skill.name
    return
  }
  actionBusy.value = `delete:${skill.name}`
  error.value = null
  try {
    await window.kernel.call('skill.delete', { name: skill.name })
    confirmingDelete.value = null
    await refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function createSkill() {
  const name = newSkillName.value.trim()
  if (!name || !canCreate.value) return
  actionBusy.value = 'create'
  error.value = null
  try {
    const result = await window.kernel.call('skill.create', {
      name,
      ...(newSkillDescription.value.trim() ? { description: newSkillDescription.value.trim() } : {}),
    }) as { skill?: { dir?: string } }
    const dir = result.skill?.dir
    clearDialogState()
    await refresh()
    if (dir) await window.kernel.revealInFinder(dir)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function pickImportFolder() {
  const selected = await window.kernel.openFolderDialog()
  if (selected) importFolder.value = selected
}

async function inspectImport() {
  if (!canInspectImport.value) return
  actionBusy.value = 'inspect-import'
  error.value = null
  importReview.value = null
  try {
    importReview.value = await window.kernel.call('skill.inspectImport', { folder: importFolder.value.trim() }) as SkillReview
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function confirmImport() {
  if (!importReview.value) return
  actionBusy.value = 'import'
  error.value = null
  try {
    const result = await window.kernel.call('skill.import', {
      folder: importFolder.value.trim(),
      confirmed: true,
    }) as { skill?: { dir?: string } }
    const dir = result.skill?.dir
    clearDialogState()
    await refresh()
    if (dir) await window.kernel.revealInFinder(dir)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function pickSourceFolder() {
  const selected = await window.kernel.openFolderDialog()
  if (selected) sourceLocation.value = selected
}

function sourceParams(confirmed = false) {
  const location = sourceLocation.value.trim()
  const looksLikeGit = /^(https?:\/\/|ssh:\/\/|[^/@\s]+@[^/\s]+:)/.test(location) || location.endsWith('.git')
  return {
    ...(sourceId.value.trim() ? { id: sourceId.value.trim() } : {}),
    ...(sourceName.value.trim() ? { name: sourceName.value.trim() } : {}),
    ...(looksLikeGit ? { git: location } : { path: location }),
    ...(confirmed ? { confirmed: true } : {}),
  }
}

async function inspectSource() {
  if (!canInspectSource.value) return
  actionBusy.value = 'inspect-source'
  error.value = null
  sourceReview.value = null
  try {
    sourceReview.value = await window.kernel.call('skillSource.inspect', sourceParams()) as SourceReview
    sourceId.value = sourceReview.value.id
    sourceName.value = sourceReview.value.name ?? sourceName.value
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function confirmSource() {
  if (!sourceReview.value) return
  actionBusy.value = 'add-source'
  error.value = null
  try {
    await window.kernel.call('skillSource.add', sourceParams(true))
    clearDialogState()
    await refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function refreshSource(source: SkillSourceItem) {
  actionBusy.value = `refresh-source:${source.id}`
  error.value = null
  try {
    await window.kernel.call('skillSource.refresh', { id: source.id })
    await refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function removeSource(source: SkillSourceItem) {
  if (confirmingSourceRemove.value !== source.id) {
    confirmingSourceRemove.value = source.id
    return
  }
  actionBusy.value = `remove-source:${source.id}`
  error.value = null
  try {
    await window.kernel.call('skillSource.remove', { id: source.id })
    confirmingSourceRemove.value = null
    await refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

function onChanged() {
  void refresh()
}

onMounted(() => {
  void refresh()
  window.kernel.on('workspace:changed', onChanged)
  window.kernel.on('skills:changed', onChanged)
})

onBeforeUnmount(() => {
  window.kernel.off('workspace:changed', onChanged)
  window.kernel.off('skills:changed', onChanged)
})
</script>

<template>
  <section aria-label="Skills settings" class="flex flex-col gap-4 text-ink">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-rule-light pb-3">
      <div class="min-w-0">
        <p class="font-sans text-[12px] text-ink-2">
          {{ skills.length }} authored skills · {{ sources.length }} sources
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          data-testid="skill-refresh"
          class="flex h-8 w-8 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-50"
          title="Refresh"
          :disabled="loading"
          @click="refresh"
        >
          <IconRefresh :size="15" :stroke-width="2" />
        </button>
        <MimMenu
          placement="bottom-end"
          aria-label="Add skills"
          trigger-class="h-8 rounded-[6px] border border-rule bg-surface px-2.5 font-sans text-[12px] font-semibold text-ink hover:bg-chrome-high"
          :trigger-attrs="{ 'data-testid': 'skill-add-menu' }"
        >
          <template #trigger>
            <span class="flex items-center gap-1.5">
              <IconPlus :size="14" :stroke-width="2" />
              <span>Add</span>
              <IconChevronDown :size="13" :stroke-width="2" />
            </span>
          </template>
          <MimMenuItem :button-attrs="{ 'data-testid': 'skill-add-source' }" @select="activeDialog = 'source'">
            Add a source...
          </MimMenuItem>
          <MimMenuItem :button-attrs="{ 'data-testid': 'skill-import-open' }" @select="activeDialog = 'import'">
            Import skill from folder...
          </MimMenuItem>
          <MimMenuItem :button-attrs="{ 'data-testid': 'skill-new-open' }" @select="activeDialog = 'new'">
            New Personal skill...
          </MimMenuItem>
        </MimMenu>
      </div>
    </div>

    <div v-if="error" class="rounded-[6px] border border-rem/30 px-3 py-2 font-sans text-[12px] text-rem">
      {{ error }}
    </div>

    <div v-if="!loading && !skills.length" class="rounded-[8px] border border-rule-light bg-surface px-3 py-4 font-sans text-[12px] text-ink-3">
      No authored skills discovered
    </div>

    <section v-for="group in groupedSkills" :key="group.key" class="flex flex-col">
      <header class="flex min-h-8 items-center justify-between gap-2 border-b border-rule-light py-1">
        <div class="min-w-0">
          <h2 class="truncate font-sans text-[10px] font-semibold uppercase tracking-[1.6px] text-ink-3">
            {{ group.label }}
          </h2>
          <p v-if="group.sourceItem" class="truncate font-sans text-[11px] text-ink-3">
            {{ group.sourceItem.kind }} · {{ group.sourceItem.location }}
          </p>
        </div>
        <div v-if="group.sourceItem" class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="flex h-7 items-center gap-1 rounded-[6px] px-2 font-sans text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-50"
            :data-testid="`skill-source-refresh-${group.sourceItem.id}`"
            :disabled="actionBusy === `refresh-source:${group.sourceItem.id}`"
            @click="refreshSource(group.sourceItem)"
          >
            <IconRefresh :size="13" :stroke-width="2" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            class="flex h-7 items-center gap-1 rounded-[6px] px-2 font-sans text-[11px] text-rem hover:bg-rem/10 disabled:opacity-50"
            :data-testid="`skill-source-remove-${group.sourceItem.id}`"
            :disabled="actionBusy === `remove-source:${group.sourceItem.id}`"
            @click="removeSource(group.sourceItem)"
          >
            <IconTrash :size="13" :stroke-width="2" />
            <span>{{ confirmingSourceRemove === group.sourceItem.id ? 'Confirm' : 'Remove' }}</span>
          </button>
        </div>
      </header>

      <div class="divide-y divide-rule-light">
        <div
          v-for="skill in group.items"
          :key="skill.id + ':' + skill.source + ':' + (skill.sourceId || '')"
          :data-testid="`skill-row-${skill.name}`"
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3"
          :class="skill.enabled ? '' : 'opacity-60'"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-[12px] font-semibold text-ink">{{ skill.name }}</span>
              <span class="rounded-[4px] border border-rule-light px-1.5 py-0.5 font-sans text-[9px] font-semibold uppercase tracking-[0.6px] text-ink-3">
                {{ sourceBadge(skill) }}
              </span>
              <span v-if="skill.shadows?.length" class="rounded-[4px] border border-accent/25 bg-accent-soft px-1.5 py-0.5 font-sans text-[9px] font-semibold text-accent">
                Shadows {{ shadowLabel(skill) }}
              </span>
            </div>
            <p class="mt-1 line-clamp-2 font-sans text-[12px] leading-5 text-ink-2">
              {{ skill.description }}
            </p>
            <div v-if="chipItems(skill).length" class="mt-2 flex flex-wrap gap-1">
              <code
                v-for="item in chipItems(skill)"
                :key="item.key"
                class="rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px]"
                :class="item.tone"
              >
                {{ item.prefix }} {{ item.label }}
              </code>
            </div>
            <div v-if="skillDiagnostics(skill).length" class="mt-2 flex flex-col gap-1">
              <div
                v-for="diagnostic in skillDiagnostics(skill)"
                :key="diagnostic.path + diagnostic.message"
                class="font-sans text-[11px] text-rem"
              >
                {{ diagnostic.message }}
              </div>
            </div>
          </div>

          <div class="flex shrink-0 items-start gap-1">
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              title="Reveal folder"
              :data-testid="`skill-reveal-${skill.name}`"
              @click="revealSkill(skill)"
            >
              <IconFolder :size="14" :stroke-width="2" />
            </button>
            <button
              v-if="skill.source === 'personal'"
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              title="Edit"
              :data-testid="`skill-edit-${skill.name}`"
              @click="editSkill(skill)"
            >
              <IconPencil :size="14" :stroke-width="2" />
            </button>
            <button
              v-if="skill.source === 'personal'"
              type="button"
              class="flex h-7 items-center justify-center rounded-[6px] px-2 font-sans text-[11px] text-rem hover:bg-rem/10 disabled:opacity-50"
              title="Delete"
              :data-testid="`skill-delete-${skill.name}`"
              :disabled="actionBusy === `delete:${skill.name}`"
              @click="deleteSkill(skill)"
            >
              <IconTrash v-if="confirmingDelete !== skill.name" :size="14" :stroke-width="2" />
              <span v-else>Confirm</span>
            </button>
            <MimToggle
              :model-value="skill.enabled"
              :disabled="actionBusy === `toggle:${skill.name}`"
              :aria-label="`${skill.name} ${skill.enabled ? 'enabled' : 'disabled'}`"
              @update:model-value="toggleSkill(skill, $event)"
            />
          </div>
        </div>
      </div>
    </section>

    <MimDialog :open="activeDialog === 'new'" title="New Personal skill" size="md" @close="clearDialogState">
      <form class="flex flex-col gap-3 p-4" @submit.prevent="createSkill">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Name</span>
          <input
            v-model="newSkillName"
            data-testid="skill-new-name"
            class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
            placeholder="skill-name"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Description</span>
          <input
            v-model="newSkillDescription"
            data-testid="skill-new-description"
            class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-sans text-[12px] text-ink outline-none focus:border-accent"
            placeholder="Use when..."
          />
        </label>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="h-8 rounded-[6px] px-3 font-sans text-[12px] text-ink-2 hover:bg-chrome-mid" @click="clearDialogState">
            Cancel
          </button>
          <button
            type="submit"
            data-testid="skill-create"
            class="flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 font-sans text-[12px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
            :disabled="!canCreate || actionBusy === 'create'"
          >
            <IconPlus :size="14" :stroke-width="2" />
            <span>Create</span>
          </button>
        </div>
      </form>
    </MimDialog>

    <MimDialog :open="activeDialog === 'import'" title="Import skill" size="md" @close="clearDialogState">
      <div class="flex flex-col gap-3 p-4">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Folder</span>
          <div class="flex gap-2">
            <input
              v-model="importFolder"
              data-testid="skill-import-folder"
              class="h-8 min-w-0 flex-1 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
              placeholder="/path/to/skill-folder"
            />
            <button type="button" class="h-8 rounded-[6px] border border-rule-light px-2 font-sans text-[11px] text-ink-2 hover:bg-chrome-mid" @click="pickImportFolder">
              Browse
            </button>
          </div>
        </label>
        <button
          type="button"
          data-testid="skill-import-inspect"
          class="flex h-8 w-fit items-center gap-1.5 rounded-[6px] border border-rule bg-surface px-3 font-sans text-[12px] font-semibold text-ink hover:bg-chrome-high disabled:opacity-50"
          :disabled="!canInspectImport || actionBusy === 'inspect-import'"
          @click="inspectImport"
        >
          <IconDownload :size="14" :stroke-width="2" />
          <span>Inspect</span>
        </button>
        <div v-if="importReview" class="rounded-[8px] border border-rule-light bg-chrome-mid p-3">
          <div class="font-mono text-[12px] font-semibold text-ink">{{ importReview.skill.name }}</div>
          <p class="mt-1 font-sans text-[12px] leading-5 text-ink-2">{{ importReview.skill.description }}</p>
          <div v-if="importReview.unlocks?.length" class="mt-2 flex flex-wrap gap-1">
            <code v-for="name in importReview.unlocks" :key="name" class="rounded-[4px] border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent">
              Uses {{ name }}
            </code>
          </div>
          <p v-if="importReview.collision" class="mt-2 font-sans text-[11px] text-rem">A Personal skill with this name already exists.</p>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="h-8 rounded-[6px] px-3 font-sans text-[12px] text-ink-2 hover:bg-chrome-mid" @click="clearDialogState">
              Cancel
            </button>
            <button
              type="button"
              data-testid="skill-import-confirm"
              class="h-8 rounded-[6px] bg-accent px-3 font-sans text-[12px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
              :disabled="Boolean(importReview.collision) || actionBusy === 'import'"
              @click="confirmImport"
            >
              Import
            </button>
          </div>
        </div>
      </div>
    </MimDialog>

    <MimDialog :open="activeDialog === 'source'" title="Add skill source" size="md" @close="clearDialogState">
      <div class="flex flex-col gap-3 p-4">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Git URL or local folder</span>
          <div class="flex gap-2">
            <input
              v-model="sourceLocation"
              data-testid="skill-source-location"
              class="h-8 min-w-0 flex-1 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
              placeholder="https://github.com/team/skills.git or /path/to/skills"
            />
            <button type="button" class="h-8 rounded-[6px] border border-rule-light px-2 font-sans text-[11px] text-ink-2 hover:bg-chrome-mid" @click="pickSourceFolder">
              Browse
            </button>
          </div>
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-1">
            <span class="font-sans text-[11px] font-semibold text-ink-2">ID</span>
            <input
              v-model="sourceId"
              data-testid="skill-source-id"
              class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
              placeholder="team"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="font-sans text-[11px] font-semibold text-ink-2">Label</span>
            <input
              v-model="sourceName"
              data-testid="skill-source-name"
              class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-sans text-[12px] text-ink outline-none focus:border-accent"
              placeholder="Team skills"
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="skill-source-inspect"
          class="flex h-8 w-fit items-center gap-1.5 rounded-[6px] border border-rule bg-surface px-3 font-sans text-[12px] font-semibold text-ink hover:bg-chrome-high disabled:opacity-50"
          :disabled="!canInspectSource || actionBusy === 'inspect-source'"
          @click="inspectSource"
        >
          <IconDownload :size="14" :stroke-width="2" />
          <span>Inspect</span>
        </button>
        <div v-if="sourceReview" class="rounded-[8px] border border-rule-light bg-chrome-mid p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="font-sans text-[12px] font-semibold text-ink">{{ sourceReview.name || sourceReview.id }}</div>
              <p class="font-sans text-[11px] text-ink-3">{{ sourceReview.skillCount }} skills · {{ sourceReview.kind }}</p>
            </div>
          </div>
          <div v-if="sourceReview.unlocks?.length" class="mt-2 flex flex-wrap gap-1">
            <code v-for="name in sourceReview.unlocks" :key="name" class="rounded-[4px] border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] text-accent">
              Uses {{ name }}
            </code>
          </div>
          <div v-if="sourceReview.diagnostics?.length" class="mt-2 flex flex-col gap-1">
            <p v-for="message in sourceReview.diagnostics" :key="message" class="font-sans text-[11px] text-rem">
              {{ message }}
            </p>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="h-8 rounded-[6px] px-3 font-sans text-[12px] text-ink-2 hover:bg-chrome-mid" @click="clearDialogState">
              Cancel
            </button>
            <button
              type="button"
              data-testid="skill-source-confirm"
              class="h-8 rounded-[6px] bg-accent px-3 font-sans text-[12px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
              :disabled="actionBusy === 'add-source'"
              @click="confirmSource"
            >
              Add source
            </button>
          </div>
        </div>
      </div>
    </MimDialog>
  </section>
</template>
