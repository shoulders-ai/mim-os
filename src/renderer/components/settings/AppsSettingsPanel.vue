<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IconPlus } from '@tabler/icons-vue'
import { useAppsStore } from '../../stores/coreApps.js'
import { useToastStore } from '../../stores/toasts.js'
import type { ResolvedApp } from '../../stores/coreApps.js'
import type {
  PackageCapabilities,
  PackageDiagnostic,
  PackageSummary,
} from '../packages/packageManagerTypes.js'
import {
  availableEntries,
  filterByText,
  isManageableApp,
  nonOkRegistries as getNonOkRegistries,
  registryDisplayName,
  registryEntryAction,
  visibleEntries,
} from '../apps/appsSurfaceLogic.js'
import type { RegistryEntry, RegistryInfo } from '../apps/appsSurfaceLogic.js'
import { permissionLines } from '../packages/permissionSummary.js'
import PermissionConfirmDialog from '../apps/PermissionConfirmDialog.vue'
import MimDialog from '../ui/MimDialog.vue'
import MimSelect from '../ui/MimSelect.vue'
import MimToggle from '../ui/MimToggle.vue'

const emit = defineEmits<{
  openPackage: [id: string]
  openPackageDocs: [id: string]
}>()

const appsStore = useAppsStore()
const toastStore = useToastStore()

const smallButtonClass = 'inline-flex h-[22px] items-center justify-center whitespace-nowrap rounded-[5px] border border-rule bg-chrome-high px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50'
const primaryButtonClass = 'inline-flex h-[22px] items-center justify-center whitespace-nowrap rounded-[5px] border border-accent bg-accent px-2 text-[10.5px] font-semibold text-accent-ink hover:bg-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50'
const dangerButtonClass = 'inline-flex h-[22px] items-center justify-center whitespace-nowrap rounded-[5px] border border-rem/40 bg-chrome-high px-2 text-[10.5px] font-medium text-rem hover:bg-rem/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50'
const sectionTitleClass = 'mb-1.5 text-[9px] font-semibold uppercase tracking-[1.8px] text-ink-3'

// ---- Core data ----
const loading = ref(false)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const actionBusy = ref<string | null>(null)
const packages = ref<PackageSummary[]>([])
const diagnostics = ref<PackageDiagnostic[]>([])
const capabilities = ref<PackageCapabilities[]>([])
const filterText = ref('')
const expandedId = ref<string | null>(null)
const developerOpenIds = ref<Record<string, boolean>>({})

// ---- Registry state ----
const registryEntries = ref<RegistryEntry[]>([])
const registries = ref<RegistryInfo[]>([])
const registryBusy = ref<string | null>(null)
const registryError = ref<string | null>(null)
const confirmAddId = ref<string | null>(null)
const confirmShareId = ref<string | null>(null)


// ---- Add source dialog state ----
const sourceDialogOpen = ref(false)
const sourceFolder = ref('')
const sourceId = ref('')
const sourceName = ref('')
const sourceDialogError = ref<string | null>(null)
const sourceBusy = ref<string | null>(null)
const sourceReview = ref<{ id: string; name?: string; location: string; appCount: number; apps: Array<{ id: string; name: string; description?: string; version: string }>; diagnostics: string[]; status: string } | null>(null)
const confirmingSourceRemove = ref<string | null>(null)

// ---- Template app dialog state ----
interface AppTemplateSummary {
  id: string
  label: string
  summary: string
  defaultId: string
  defaultName: string
}

interface PackageValidationResult {
  valid: boolean
  errors?: Array<{ path?: string; message: string }>
  warnings?: Array<{ path?: string; message: string }>
}

interface PackageCreateResult {
  created?: string
  path?: string
  files?: string[]
}

const appTemplates = ref<AppTemplateSummary[]>([])
const templateDialogOpen = ref(false)
const templateDialogError = ref<string | null>(null)
const newAppTemplateId = ref('')
const newAppId = ref('')
const newAppName = ref('')

// ---- Permission confirmation state ----
const pendingEnableRow = ref<WorkspaceRow | null>(null)

interface WorkspaceRow {
  id: string
  label: string
  description: string
  enabled: boolean
  installed: boolean
  source: string
  version?: string
  needsTrust: boolean
  needsInstall: boolean
  shadowed: boolean
  hasViews: boolean
  pkg?: PackageSummary
  app?: ResolvedApp
}

function pkgForId(id: string): PackageSummary | undefined {
  return packages.value.find(p => p.id === id)
}

const inWorkspaceRows = computed<WorkspaceRow[]>(() => {
  const rows: WorkspaceRow[] = []
  const seen = new Set<string>()

  for (const app of Object.values(appsStore.apps)) {
    if (!isManageableApp(app)) continue
    seen.add(app.id)
    const pkg = pkgForId(app.id)
    rows.push({
      id: app.id,
      label: pkg?.name ?? app.id,
      description: pkg?.description ?? '',
      enabled: app.enabled,
      installed: app.installed,
      source: app.source ?? 'unknown',
      version: app.version,
      needsTrust: app.needsTrust,
      needsInstall: app.needsInstall,
      shadowed: app.shadowed,
      hasViews: (pkg?.views?.length ?? 0) > 0,
      pkg,
      app,
    })
  }

  for (const pkg of packages.value) {
    if (seen.has(pkg.id)) continue
    if (!pkg.enabled) continue
    rows.push({
      id: pkg.id,
      label: pkg.name,
      description: pkg.description ?? '',
      enabled: pkg.enabled,
      installed: true,
      source: pkg.source,
      needsTrust: false,
      needsInstall: false,
      shadowed: false,
      hasViews: (pkg.views?.length ?? 0) > 0,
      pkg,
    })
  }

  return rows
})

const filteredInWorkspace = computed(() =>
  filterByText(inWorkspaceRows.value, filterText.value),
)

const mySidebarRows = computed(() =>
  filteredInWorkspace.value.filter(row => row.enabled && row.installed),
)

function isWorkspacePackageRow(row: WorkspaceRow): boolean {
  return row.source === 'workspace' || row.pkg?.source === 'workspace'
}

const workspaceRows = computed(() =>
  filteredInWorkspace.value.filter(row =>
    (row.app?.layer === 'workspace' || row.needsTrust || row.needsInstall || isWorkspacePackageRow(row))
    && !(row.enabled && row.installed),
  ),
)

const appSections = computed(() => [
  {
    id: 'sidebar',
    label: 'My Sidebar',
    count: mySidebarRows.value.length,
    rows: mySidebarRows.value,
    empty: filterText.value ? 'No matches' : 'No apps in your sidebar',
  },
  {
    id: 'workspace',
    label: 'Workspace Apps',
    count: workspaceRows.value.length,
    rows: workspaceRows.value,
    empty: filterText.value ? 'No matches' : 'No shared apps in this workspace',
  },
])

const inWorkspaceIds = computed(() =>
  new Set(inWorkspaceRows.value.map(r => r.id)),
)

const availableRegistryEntries = computed(() =>
  availableEntries(visibleEntries(registryEntries.value), inWorkspaceIds.value),
)

const multipleRegistries = computed(() => registries.value.length > 1)
const nonOkRegistries = computed(() => getNonOkRegistries(registries.value))
const machineSources = computed(() => registries.value.filter(r => r.origin === 'machine'))
const confirmingAddEntry = computed(() =>
  availableRegistryEntries.value.find(entry => entry.id === confirmAddId.value) ?? null,
)
const confirmingShareEntry = computed(() =>
  availableRegistryEntries.value.find(entry => entry.id === confirmShareId.value) ?? null,
)
const pendingEnableName = computed(() => pendingEnableRow.value?.label ?? '')
const pendingEnablePermissions = computed(() => pendingEnableRow.value?.pkg?.permissions ?? {})
const pendingEnableTestId = computed(() =>
  pendingEnableRow.value ? `apps-enable-permissions-${pendingEnableRow.value.id}` : undefined,
)
const pendingEnableConfirmTestId = computed(() =>
  pendingEnableRow.value ? `apps-enable-confirm-${pendingEnableRow.value.id}` : undefined,
)
const appTemplateOptions = computed(() =>
  appTemplates.value.map(template => ({
    value: template.id,
    label: template.label,
    title: template.summary,
    testId: `app-template-option-${template.id}`,
  })),
)
const selectedAppTemplate = computed(() =>
  appTemplates.value.find(template => template.id === newAppTemplateId.value) ?? null,
)
const canCreateTemplateApp = computed(() =>
  /^[a-z0-9][a-z0-9_-]*$/.test(newAppId.value.trim()) &&
  newAppName.value.trim().length > 0 &&
  Boolean(selectedAppTemplate.value),
)

// ---- Expand / collapse ----

function isExpanded(id: string): boolean {
  return expandedId.value === id
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
  actionError.value = null
}

function isDeveloperOpen(id: string): boolean {
  return developerOpenIds.value[id] === true
}

function toggleDeveloperDetails(id: string) {
  developerOpenIds.value = {
    ...developerOpenIds.value,
    [id]: !developerOpenIds.value[id],
  }
}

// ---- Row helpers ----

function rowDiagnostics(id: string): PackageDiagnostic[] {
  const loaderDiags = diagnostics.value.filter(d =>
    d.packageId === id || d.path.includes(`/${id}/`),
  )
  const capDiags = capabilities.value
    .find(c => c.packageId === id)
    ?.diagnostics.map(msg => ({ path: id, message: msg, packageId: id })) ?? []
  return [...loaderDiags, ...capDiags]
}

function capabilityGroups(id: string): Array<{ key: string; label: string; items: string[] }> {
  const caps = capabilities.value.find(c => c.packageId === id) ?? null
  return [
    { key: 'jobs', label: 'Jobs', items: caps?.jobs.map(j => j.label || j.id) ?? [] },
    { key: 'tools', label: 'Tools', items: caps?.tools.map(t => t.label || t.name) ?? [] },
    { key: 'skills', label: 'Teaches the agent', items: caps?.skills?.map(s => s.label || s.id) ?? [] },
  ].filter(g => g.items.length > 0)
}

function accessLines(row: WorkspaceRow): string[] {
  if (!row.pkg) {
    return row.needsInstall
      ? ['Install this app before access details are available']
      : ['No special access']
  }
  return permissionLines(row.pkg.permissions ?? {})
}

function rowSubtitle(row: WorkspaceRow): string {
  if (row.description.trim()) return row.description
  if (row.needsInstall) return 'Install needed'
  if (row.needsTrust) return 'Review access to enable'
  if (row.enabled) return row.app?.layer === 'workspace' ? 'In my sidebar, shared with workspace' : 'In my sidebar'
  if (row.app?.layer === 'workspace') return 'Shared with workspace'
  if (isWorkspacePackageRow(row)) return 'In workspace, not in my sidebar'
  return 'Available'
}

// ---- Actions ----

async function toggleEnabled(row: WorkspaceRow) {
  if (!row.enabled && row.needsTrust) {
    pendingEnableRow.value = row
    actionError.value = null
    return
  }

  actionBusy.value = `toggle:${row.id}`
  actionError.value = null
  try {
    await appsStore.setEnabled(row.id, !row.enabled)
  } catch (err) {
    actionError.value = (err as Error).message
    expandedId.value = row.id
  } finally {
    actionBusy.value = null
    await refreshAll()
  }
}

async function confirmEnableWithPermissions() {
  const row = pendingEnableRow.value
  if (!row) return
  actionBusy.value = `toggle:${row.id}`
  actionError.value = null
  try {
    await appsStore.trust(row.id)
    await appsStore.setEnabled(row.id, true)
    pendingEnableRow.value = null
  } catch (err) {
    actionError.value = (err as Error).message
    expandedId.value = row.id
    pendingEnableRow.value = null
  } finally {
    actionBusy.value = null
    await refreshAll()
  }
}

function onEnableDialogOpenChange(open: boolean) {
  if (!open) pendingEnableRow.value = null
}

async function removeApp(row: WorkspaceRow) {
  actionBusy.value = `remove:${row.id}`
  actionError.value = null
  try {
    await appsStore.remove(row.id)
    confirmRemoveId.value = null
    await refreshAll()
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

const confirmRemoveId = ref<string | null>(null)

function toggleRemoveConfirm(id: string) {
  confirmRemoveId.value = confirmRemoveId.value === id ? null : id
}

async function updateApp(row: WorkspaceRow) {
  actionBusy.value = `update:${row.id}`
  actionError.value = null
  try {
    await window.kernel.call('package.update', { id: row.id })
    await refreshAll()
    await refreshRegistry()
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

async function installWorkspaceApp(row: WorkspaceRow) {
  actionBusy.value = `install-source:${row.id}`
  actionError.value = null
  try {
    await window.kernel.call('package.install', {
      id: row.id,
      ...(row.version ? { version: row.version } : {}),
    })
    await refreshAll()
    await appsStore.refresh()
  } catch (err) {
    actionError.value = (err as Error).message
  } finally {
    actionBusy.value = null
  }
}

// ---- Template app dialog actions ----

function selectAppTemplate(value: string | number) {
  newAppTemplateId.value = String(value)
  const template = selectedAppTemplate.value
  if (!template) return
  newAppId.value = template.defaultId
  newAppName.value = template.defaultName
}

function ensureDefaultAppTemplate() {
  if (selectedAppTemplate.value) return
  const first = appTemplates.value[0]
  if (first) selectAppTemplate(first.id)
}

function openTemplateDialog() {
  templateDialogError.value = null
  ensureDefaultAppTemplate()
  templateDialogOpen.value = true
}

function clearTemplateDialog() {
  templateDialogOpen.value = false
  templateDialogError.value = null
  newAppTemplateId.value = ''
  newAppId.value = ''
  newAppName.value = ''
}

function validationMessage(result: PackageValidationResult): string {
  const errors = result.errors ?? []
  if (!errors.length) return 'App validation failed'
  return errors.map(error => error.path ? `${error.message} (${error.path})` : error.message).join('; ')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function revealCreatedAppFolder(path: string | undefined) {
  if (!path) {
    toastStore.push({ kind: 'info', message: 'App created' })
    return
  }
  try {
    await window.kernel.revealInFinder(path)
    toastStore.push({ kind: 'info', message: 'App created, showing folder contents' })
  } catch (err) {
    toastStore.push({
      kind: 'info',
      message: 'App created',
      detail: `Folder could not be opened: ${errorMessage(err)}`,
    })
  }
}

async function createTemplateApp() {
  if (!canCreateTemplateApp.value) return
  const id = newAppId.value.trim()
  const name = newAppName.value.trim()
  actionBusy.value = 'create-template-app'
  templateDialogError.value = null
  try {
    const params = await window.kernel.call('app.templateContent', {
      templateId: newAppTemplateId.value,
      id,
      name,
    }) as Record<string, unknown>
    const createdId = typeof params.id === 'string' ? params.id : id
    const created = await window.kernel.call('package.create', params) as PackageCreateResult
    const validation = await window.kernel.call('package.validate', { id: createdId }) as PackageValidationResult
    if (!validation.valid) throw new Error(validationMessage(validation))
    await window.kernel.call('package.reload', { id: createdId })
    clearTemplateDialog()
    expandedId.value = createdId
    await refreshAll()
    await revealCreatedAppFolder(created.path)
  } catch (err) {
    templateDialogError.value = errorMessage(err)
  } finally {
    actionBusy.value = null
  }
}

// ---- Source dialog actions ----

function clearSourceDialog() {
  sourceDialogOpen.value = false
  sourceFolder.value = ''
  sourceId.value = ''
  sourceName.value = ''
  sourceReview.value = null
  sourceDialogError.value = null
}

async function pickSourceFolder() {
  const selected = await window.kernel.openFolderDialog()
  if (selected) {
    sourceFolder.value = selected
    await inspectAppSource()
  }
}

async function inspectAppSource() {
  const path = sourceFolder.value.trim()
  if (!path) return
  sourceBusy.value = 'inspect'
  sourceDialogError.value = null
  sourceReview.value = null
  try {
    sourceReview.value = await window.kernel.call('registry.inspectSource', {
      path,
      ...(sourceId.value.trim() ? { id: sourceId.value.trim() } : {}),
      ...(sourceName.value.trim() ? { name: sourceName.value.trim() } : {}),
    }) as typeof sourceReview.value
    if (sourceReview.value) {
      sourceId.value = sourceReview.value.id
      if (sourceReview.value.name) sourceName.value = sourceReview.value.name
    }
  } catch (err) {
    sourceDialogError.value = (err as Error).message
  } finally {
    sourceBusy.value = null
  }
}

async function confirmAddSource() {
  if (!sourceReview.value) return
  sourceBusy.value = 'add'
  sourceDialogError.value = null
  try {
    await window.kernel.call('registry.addSource', {
      id: sourceId.value.trim(),
      path: sourceFolder.value.trim(),
      ...(sourceName.value.trim() ? { name: sourceName.value.trim() } : {}),
      confirmed: true,
    })
    clearSourceDialog()
    await refreshAll()
  } catch (err) {
    sourceDialogError.value = (err as Error).message
  } finally {
    sourceBusy.value = null
  }
}

async function removeAppSource(id: string) {
  if (confirmingSourceRemove.value !== id) {
    confirmingSourceRemove.value = id
    return
  }
  sourceBusy.value = `remove:${id}`
  registryError.value = null
  try {
    await window.kernel.call('registry.removeSource', { id })
    confirmingSourceRemove.value = null
    await refreshAll()
  } catch (err) {
    registryError.value = (err as Error).message
  } finally {
    sourceBusy.value = null
  }
}

// ---- Registry actions ----

async function refreshRegistry() {
  const result = await window.kernel.call('registry.list') as {
    registries: RegistryInfo[]
    entries: RegistryEntry[]
  }
  registries.value = result.registries ?? []
  registryEntries.value = result.entries ?? []
}

async function trustRegistry(id: string) {
  registryBusy.value = `trust-registry:${id}`
  registryError.value = null
  try {
    await window.kernel.call('registry.trust', { id })
    await refreshRegistry()
  } catch (err) {
    registryError.value = (err as Error).message
  } finally {
    registryBusy.value = null
  }
}

function toggleAddConfirm(entry: RegistryEntry) {
  confirmAddId.value = entry.id
  registryError.value = null
}

function onAddDialogOpenChange(open: boolean) {
  if (!open) confirmAddId.value = null
}

function toggleShareConfirm(entry: RegistryEntry) {
  confirmShareId.value = entry.id
  registryError.value = null
}

function onShareDialogOpenChange(open: boolean) {
  if (!open) confirmShareId.value = null
}

async function addToSidebar(entry: RegistryEntry) {
  registryBusy.value = `add:${entry.id}`
  registryError.value = null
  try {
    await window.kernel.call('app.add', { id: entry.id, version: entry.version })
    confirmAddId.value = null
    await refreshAll()
    await appsStore.refresh()
    await refreshRegistry()
  } catch (err) {
    registryError.value = (err as Error).message
  } finally {
    registryBusy.value = null
  }
}

async function shareWithWorkspace(entry: RegistryEntry) {
  registryBusy.value = `share:${entry.id}`
  registryError.value = null
  try {
    await window.kernel.call('app.share', { id: entry.id, version: entry.version })
    confirmShareId.value = null
    await refreshAll()
    await appsStore.refresh()
    await refreshRegistry()
  } catch (err) {
    registryError.value = (err as Error).message
  } finally {
    registryBusy.value = null
  }
}

async function registryUpdate(entry: RegistryEntry) {
  registryBusy.value = `update:${entry.id}`
  registryError.value = null
  try {
    await window.kernel.call('package.update', { id: entry.id })
    await refreshAll()
    await refreshRegistry()
  } catch (err) {
    registryError.value = (err as Error).message
  } finally {
    registryBusy.value = null
  }
}

// ---- Refresh all ----

async function refreshAll() {
  loading.value = true
  error.value = null
  try {
    const [pkgResult, capResult, templateResult] = await Promise.all([
      window.kernel.call('package.list'),
      window.kernel.call('package.capabilities.list'),
      window.kernel.call('app.templateList', {}),
      appsStore.refresh(),
      appsStore.fetchUpdates(),
    ])
    const pkgList = pkgResult as { packages: PackageSummary[]; diagnostics: PackageDiagnostic[] }
    const templateList = templateResult as { templates?: AppTemplateSummary[] }
    packages.value = pkgList.packages ?? []
    diagnostics.value = pkgList.diagnostics ?? []
    capabilities.value = (capResult as { packages: PackageCapabilities[] }).packages ?? []
    appTemplates.value = templateList.templates ?? []
    refreshRegistry().catch(() => {})
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

// ---- Event handlers ----

function onAppsChanged() { appsStore.refresh() }
function onPackagesChanged() { refreshAll() }
function onAccountChanged() { refreshAll() }
function onWorkspaceChanged() {
  expandedId.value = null
  developerOpenIds.value = {}
  pendingEnableRow.value = null
  confirmAddId.value = null
  confirmShareId.value = null
  refreshAll()
}
function onAppsUpdates(payload: unknown) {
  const data = payload as { updates: Array<{ id: string; installed: string; latest: string; registryId: string }> }
  const map: Record<string, { installed: string; latest: string; registryId: string }> = {}
  for (const u of data.updates ?? []) {
    map[u.id] = { installed: u.installed, latest: u.latest, registryId: u.registryId }
  }
  appsStore.setUpdates(map)
}

// ---- Lifecycle ----

onMounted(() => {
  refreshAll()
  window.kernel.on('apps:changed', onAppsChanged)
  window.kernel.on('packages:changed', onPackagesChanged)
  window.kernel.on('account:changed', onAccountChanged)
  window.kernel.on('workspace:changed', onWorkspaceChanged)
  window.kernel.on('apps:updates', onAppsUpdates)
})

onBeforeUnmount(() => {
  window.kernel.off('apps:changed', onAppsChanged)
  window.kernel.off('packages:changed', onPackagesChanged)
  window.kernel.off('account:changed', onAccountChanged)
  window.kernel.off('workspace:changed', onWorkspaceChanged)
  window.kernel.off('apps:updates', onAppsUpdates)
})

watch(inWorkspaceRows, (rows) => {
  if (expandedId.value && !rows.some(r => r.id === expandedId.value)) {
    expandedId.value = null
  }
  const ids = new Set(rows.map(r => r.id))
  const nextOpen: Record<string, boolean> = {}
  for (const [id, open] of Object.entries(developerOpenIds.value)) {
    if (open && ids.has(id)) nextOpen[id] = true
  }
  developerOpenIds.value = nextOpen
}, { immediate: true })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col px-5 pt-4 font-sans">
    <div class="flex items-center gap-2 pb-3">
      <label
        v-if="inWorkspaceRows.length > 3 || filterText"
        class="flex h-6 items-center gap-1.5 rounded-[6px] border border-rule-light bg-chrome-mid px-2 text-ink-3 focus-within:border-accent"
      >
        <svg class="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          v-model="filterText"
          placeholder="Filter apps"
          class="w-[120px] min-w-0 border-0 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-4"
        />
      </label>
      <span class="font-mono text-[9px] text-ink-3">{{ mySidebarRows.length }} in sidebar</span>
      <button
        type="button"
        data-testid="app-new-template-open"
        class="ml-auto flex h-[22px] items-center gap-1 rounded-[5px] border border-rule bg-chrome-high px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-50"
        :disabled="!appTemplates.length"
        title="Create workspace app"
        @click="openTemplateDialog"
      >
        <IconPlus :size="12" :stroke-width="2" />
        <span>New app</span>
      </button>
      <button
        type="button"
        class="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-50"
        :disabled="loading"
        title="Refresh"
        @click="refreshAll"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M16 8h5V3" />
        </svg>
      </button>
    </div>

    <div v-if="error" class="mb-2 rounded-[6px] border border-rem/30 px-2.5 py-2 text-[11.5px] text-rem">{{ error }}</div>
    <div v-if="actionError" class="mb-2 rounded-[6px] border border-rem/30 px-2.5 py-2 text-[11.5px] text-rem">{{ actionError }}</div>
    <div v-if="registryError" class="mb-2 rounded-[6px] border border-rem/30 px-2.5 py-2 text-[11.5px] text-rem">{{ registryError }}</div>

    <div class="flex-1 overflow-y-auto pr-1">
      <section v-for="section in appSections" :key="section.id" class="mb-4">
        <div class="mb-1.5 flex items-center justify-between">
          <h2 class="text-[9px] font-semibold uppercase tracking-[1.8px] text-ink-3">{{ section.label }}</h2>
          <span class="font-mono text-[9px] text-ink-4">{{ section.count }}</span>
        </div>
        <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
          <div
            v-for="row in section.rows"
            :key="`${section.id}-${row.id}`"
            class="apps-row-wrapper border-b border-rule-light last:border-b-0"
            :class="isExpanded(row.id) ? 'bg-chrome-high' : ''"
          >
            <div class="flex items-stretch" :class="isExpanded(row.id) ? '' : 'hover:bg-chrome-mid'">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                :data-testid="`apps-row-${row.id}`"
                :aria-expanded="isExpanded(row.id)"
                @click="toggleExpand(row.id)"
              >
                <svg class="shrink-0 text-ink-4 transition-transform duration-150 motion-reduce:transition-none" :class="isExpanded(row.id) ? 'rotate-90' : ''" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-ink">
                    {{ row.label }}
                    <span v-if="row.shadowed" :data-testid="`override-badge-${row.id}`" class="inline-flex h-[17px] items-center rounded-full bg-accent-soft px-1.5 text-[9px] font-semibold text-accent">Local override</span>
                    <span v-if="appsStore.updates[row.id]" :data-testid="`app-update-${row.id}`" class="inline-flex h-[17px] items-center rounded-full bg-add/10 px-1.5 text-[9px] font-semibold text-add">Update available</span>
                  </span>
                  <span class="mt-0.5 block truncate text-[10px] leading-4 text-ink-3">{{ rowSubtitle(row) }}</span>
                </span>
                <span v-if="rowDiagnostics(row.id).length" class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-rem/10 px-1 font-mono text-[9px] font-semibold text-rem">{{ rowDiagnostics(row.id).length }}</span>
              </button>
              <div class="flex items-center gap-3 pl-3 pr-3">
                <button
                  v-if="row.hasViews && row.enabled"
                  type="button"
                  :data-testid="`app-open-${row.id}`"
                  class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  title="Open"
                  aria-label="Open"
                  @click="emit('openPackage', row.id)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" /></svg>
                </button>
                <MimToggle
                  :data-testid="`apps-toggle-${row.id}`"
                  :model-value="row.enabled"
                  :disabled="actionBusy === `toggle:${row.id}` || row.needsInstall"
                  :aria-label="`${row.label} ${row.enabled ? 'enabled' : 'disabled'}`"
                  @update:model-value="toggleEnabled(row)"
                />
              </div>
            </div>

            <div v-if="isExpanded(row.id)" class="apps-detail flex flex-col gap-2 px-3 pb-3 pt-1">
              <div v-if="row.needsInstall" class="flex items-center justify-between gap-2 rounded-[6px] bg-chrome-mid px-2.5 py-1.5 text-[11px] text-ink-2" :data-testid="`install-from-source-${row.id}`">
                <span>Install before adding to your sidebar</span>
                <button
                  type="button"
                  :class="primaryButtonClass"
                  :disabled="actionBusy === `install-source:${row.id}`"
                  @click="installWorkspaceApp(row)"
                >
                  Install
                </button>
              </div>

              <div class="rounded-[6px] bg-chrome-mid px-2.5 py-2">
                <div :class="sectionTitleClass">Access</div>
                <ul class="m-0 flex list-none flex-col gap-1 p-0">
                  <li
                    v-for="line in accessLines(row)"
                    :key="line"
                    class="flex gap-2 text-[11px] leading-5 text-ink-2"
                  >
                    <span class="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-add" />
                    <span>{{ line }}</span>
                  </li>
                </ul>
              </div>

              <div v-if="row.pkg?.hasReadme" class="flex">
                <button
                  type="button"
                  class="flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  :data-testid="`app-docs-${row.id}`"
                  title="Open documentation"
                  aria-label="Open documentation"
                  @click="emit('openPackageDocs', row.id)"
                >
                  Documentation
                </button>
              </div>

              <div v-if="rowDiagnostics(row.id).length" class="flex flex-col gap-1">
                <div class="mb-1.5 text-[9px] font-semibold uppercase tracking-[1.8px] text-rem">Needs attention</div>
                <div v-for="d in rowDiagnostics(row.id)" :key="d.path + d.message" class="rounded-[6px] border border-rem/20 bg-surface px-2 py-1.5 text-[10px] leading-5 text-ink-2">
                  {{ d.message }}
                  <code v-if="d.path !== row.id" class="ml-1 font-mono text-[9px] text-ink-4">{{ d.path }}</code>
                </div>
              </div>

              <div v-if="appsStore.updates[row.id]" class="flex flex-col gap-1">
                <button
                  type="button"
                  :class="primaryButtonClass"
                  :data-testid="`app-do-update-${row.id}`"
                  :disabled="actionBusy === `update:${row.id}`"
                  @click="updateApp(row)"
                >
                  Update to {{ appsStore.updates[row.id].latest }}
                </button>
              </div>

              <div>
                <button
                  type="button"
                  class="flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  :data-testid="`app-developer-toggle-${row.id}`"
                  :aria-expanded="isDeveloperOpen(row.id)"
                  @click="toggleDeveloperDetails(row.id)"
                >
                  <svg class="shrink-0 text-ink-4 transition-transform duration-150 motion-reduce:transition-none" :class="isDeveloperOpen(row.id) ? 'rotate-90' : ''" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                  Developer details
                </button>
                <div
                  v-if="isDeveloperOpen(row.id)"
                  :data-testid="`app-developer-details-${row.id}`"
                  class="mt-1.5 flex flex-col gap-1.5 rounded-[6px] border border-rule-light bg-surface px-2.5 py-2 text-[10px] text-ink-3"
                >
                  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span class="w-[58px] shrink-0 font-medium text-ink-4">App</span>
                    <code class="font-mono text-ink-2">{{ row.id }}</code>
                  </div>
                  <div v-if="row.pkg?.backend" class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span class="w-[58px] shrink-0 font-medium text-ink-4">Backend</span>
                    <code class="min-w-0 max-w-full truncate font-mono text-ink-2">{{ row.pkg.backend }}</code>
                  </div>
                  <div v-if="row.pkg?.version || appsStore.updates[row.id]" class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span class="w-[58px] shrink-0 font-medium text-ink-4">Version</span>
                    <span class="font-mono text-ink-2">
                      {{ appsStore.updates[row.id] ? `${appsStore.updates[row.id].installed} → ${appsStore.updates[row.id].latest}` : row.pkg?.version }}
                    </span>
                  </div>
                  <template v-if="capabilityGroups(row.id).length">
                    <div v-for="cg in capabilityGroups(row.id)" :key="cg.key" class="flex items-baseline gap-x-2 gap-y-1">
                      <span class="w-[58px] shrink-0 font-medium text-ink-4">{{ cg.label }}</span>
                      <span class="flex min-w-0 flex-wrap gap-1">
                        <code v-for="item in cg.items" :key="item" class="max-w-[220px] truncate rounded-[4px] bg-chrome-mid px-1.5 py-px font-mono text-[10px] text-ink-2">{{ item }}</code>
                      </span>
                    </div>
                  </template>
                </div>
              </div>

              <div class="flex flex-col gap-1">
                <div v-if="row.app?.layer === 'workspace' && confirmRemoveId === row.id" class="flex items-center justify-between gap-2 rounded-[6px] bg-rem/5 px-2.5 py-1.5 text-[11px] text-ink-2">
                  <span>Remove {{ row.label }} from this workspace?</span>
                  <div class="flex gap-1">
                    <button type="button" :class="smallButtonClass" @click="confirmRemoveId = null">Cancel</button>
                    <button
                      type="button"
                      :class="dangerButtonClass"
                      :data-testid="`app-remove-confirm-${row.id}`"
                      :disabled="actionBusy === `remove:${row.id}`"
                      @click="removeApp(row)"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <button
                  v-else-if="row.app?.layer === 'workspace'"
                  type="button"
                  :class="dangerButtonClass"
                  :data-testid="`app-remove-${row.id}`"
                  @click="toggleRemoveConfirm(row.id)"
                >
                  Remove from workspace
                </button>
                <button
                  v-else-if="row.enabled"
                  type="button"
                  :class="dangerButtonClass"
                  :data-testid="`app-remove-sidebar-${row.id}`"
                  :disabled="actionBusy === `toggle:${row.id}`"
                  @click="toggleEnabled(row)"
                >
                  Remove from sidebar
                </button>
              </div>
            </div>
          </div>

          <div v-if="!section.rows.length" class="px-3 py-4 text-center text-[10.5px] text-ink-4">
            {{ section.empty }}
          </div>
        </div>
      </section>

      <section class="mb-4">
        <div class="flex items-center justify-between">
          <h2 :class="sectionTitleClass">Browse</h2>
          <button
            type="button"
            data-testid="app-add-source"
            class="mb-1.5 flex h-[22px] items-center gap-1 rounded-[5px] border border-rule bg-chrome-high px-2 text-[10.5px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
            @click="sourceDialogOpen = true"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            <span>Add source</span>
          </button>
        </div>

        <div
          v-for="src in machineSources"
          :key="`machine-${src.id}`"
          :data-testid="`app-source-${src.id}`"
          class="mb-1.5 flex min-h-8 items-center justify-between gap-2 rounded-[6px] bg-chrome-high px-2.5 py-1.5"
        >
          <span class="min-w-0">
            <span class="block truncate text-[11.5px] font-medium text-ink-2">{{ src.name || src.id }}</span>
            <span class="block truncate text-[10px] text-ink-3">{{ src.location }}</span>
          </span>
          <div class="flex shrink-0 items-center gap-1">
            <span v-if="src.status === 'error'" class="text-[10px] text-rem">error</span>
            <button
              type="button"
              :data-testid="`app-source-remove-${src.id}`"
              class="inline-flex h-[22px] items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] font-medium text-rem hover:bg-rem/5"
              :disabled="sourceBusy === `remove:${src.id}`"
              @click="removeAppSource(src.id)"
            >
              {{ confirmingSourceRemove === src.id ? 'Confirm' : 'Remove' }}
            </button>
          </div>
        </div>

        <template v-for="reg in nonOkRegistries" :key="`reg-${reg.id}`">
          <div
            v-if="reg.status === 'needs-trust'"
            :data-testid="`registry-trust-${reg.id}`"
            class="mb-1.5 flex min-h-8 items-center justify-between gap-2 rounded-[6px] bg-chrome-high px-2.5 py-1.5"
          >
            <span class="min-w-0">
              <span class="block truncate text-[11.5px] font-medium text-ink-2">{{ reg.name || reg.location }}</span>
              <span class="block text-[10px] text-ink-3">This workspace uses this registry</span>
            </span>
            <button type="button" :class="primaryButtonClass" :disabled="registryBusy === `trust-registry:${reg.id}`" @click="trustRegistry(reg.id)">Use this registry</button>
          </div>
          <div
            v-else-if="reg.status === 'stale'"
            :data-testid="`registry-stale-${reg.id}`"
            class="mb-1.5 text-[10px] text-ink-3"
          >
            Couldn't refresh {{ reg.name || reg.id }} - showing cached entries{{ reg.error ? `: ${reg.error}` : '' }}
          </div>
          <div
            v-else-if="reg.status === 'error'"
            :data-testid="`registry-error-${reg.id}`"
            class="mb-1.5 text-[10px] text-rem"
          >
            Registry {{ reg.name || reg.id }} failed{{ reg.error ? `: ${reg.error}` : '' }}
          </div>
        </template>

        <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
          <div v-if="!availableRegistryEntries.length && !loading" class="px-3 py-4 text-center text-[10.5px] text-ink-4">
            No available apps in registry
          </div>

          <div
            v-for="entry in availableRegistryEntries"
            :key="entry.id"
            class="border-b border-rule-light px-3 py-2 last:border-b-0"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <span class="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-ink">
                  <span class="truncate">{{ entry.name }}</span>
                  <span v-if="multipleRegistries" class="shrink-0 text-[9px] font-normal text-ink-4" :data-testid="`registry-source-tag-${entry.id}`">{{ registryDisplayName(registries, entry.registryId) }}</span>
                </span>
                <span v-if="entry.description" class="mt-0.5 block text-[10px] leading-4 text-ink-3">{{ entry.description }}</span>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <span class="font-mono text-[10px] text-ink-4">{{ entry.version }}</span>
                <button
                  v-if="registryEntryAction(entry) === 'add'"
                  type="button"
                  :data-testid="`registry-add-${entry.id}`"
                  :class="primaryButtonClass"
                  :disabled="registryBusy === `add:${entry.id}`"
                  @click="toggleAddConfirm(entry)"
                >
                  Add to sidebar
                </button>
                <button
                  v-if="registryEntryAction(entry) === 'add'"
                  type="button"
                  :data-testid="`registry-share-${entry.id}`"
                  :class="smallButtonClass"
                  :disabled="registryBusy === `share:${entry.id}`"
                  @click="toggleShareConfirm(entry)"
                >
                  Share
                </button>
                <button
                  v-else-if="registryEntryAction(entry) === 'update'"
                  type="button"
                  :data-testid="`registry-update-${entry.id}`"
                  :class="smallButtonClass"
                  :disabled="registryBusy === `update:${entry.id}`"
                  @click="registryUpdate(entry)"
                >
                  Update
                </button>
                <span
                  v-else
                  :data-testid="`registry-added-${entry.id}`"
                  class="text-[10px] font-medium text-add"
                >
                  In sidebar
                </span>
              </div>
            </div>
          </div>
        </div>

      </section>
    </div>

    <PermissionConfirmDialog
      :open="pendingEnableRow !== null"
      :app-name="pendingEnableName"
      :permissions="pendingEnablePermissions"
      confirm-label="Enable"
      :test-id="pendingEnableTestId"
      :confirm-test-id="pendingEnableConfirmTestId"
      @confirm="confirmEnableWithPermissions"
      @cancel="pendingEnableRow = null"
      @update:open="onEnableDialogOpenChange"
    />

    <PermissionConfirmDialog
      :open="confirmingAddEntry !== null"
      :app-name="confirmingAddEntry?.name ?? ''"
      :permissions="confirmingAddEntry?.permissions ?? {}"
      confirm-label="Add to sidebar"
      :test-id="confirmingAddEntry ? `registry-add-card-${confirmingAddEntry.id}` : undefined"
      :confirm-test-id="confirmingAddEntry ? `registry-add-confirm-${confirmingAddEntry.id}` : undefined"
      @confirm="confirmingAddEntry && addToSidebar(confirmingAddEntry)"
      @cancel="confirmAddId = null"
      @update:open="onAddDialogOpenChange"
    />

    <PermissionConfirmDialog
      :open="confirmingShareEntry !== null"
      :app-name="confirmingShareEntry?.name ?? ''"
      :permissions="confirmingShareEntry?.permissions ?? {}"
      confirm-label="Share with workspace"
      :test-id="confirmingShareEntry ? `registry-share-card-${confirmingShareEntry.id}` : undefined"
      :confirm-test-id="confirmingShareEntry ? `registry-share-confirm-${confirmingShareEntry.id}` : undefined"
      @confirm="confirmingShareEntry && shareWithWorkspace(confirmingShareEntry)"
      @cancel="confirmShareId = null"
      @update:open="onShareDialogOpenChange"
    />

    <MimDialog :open="templateDialogOpen" title="Create workspace app" size="md" @close="clearTemplateDialog">
      <form class="flex flex-col gap-3 p-4" @submit.prevent="createTemplateApp">
        <p class="font-sans text-[11px] leading-4 text-ink-3">
          Choose a template, then Mim creates and validates a new app folder in this workspace.
        </p>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Select template</span>
          <MimSelect
            :model-value="newAppTemplateId"
            :options="appTemplateOptions"
            tone="chrome"
            :trigger-attrs="{ 'data-testid': 'app-new-template' }"
            @update:model-value="selectAppTemplate"
          />
          <span v-if="selectedAppTemplate" class="font-sans text-[11px] leading-4 text-ink-3">
            {{ selectedAppTemplate.summary }}
          </span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">App folder ID</span>
          <input
            v-model="newAppId"
            data-testid="app-new-id"
            class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
            placeholder="app-id"
          />
          <span class="font-sans text-[10.5px] leading-4 text-ink-4">Lowercase letters, numbers, hyphens, and underscores.</span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Display name</span>
          <input
            v-model="newAppName"
            data-testid="app-new-name"
            class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-sans text-[12px] text-ink outline-none focus:border-accent"
            placeholder="App name"
          />
        </label>
        <div v-if="templateDialogError" data-testid="app-template-error" class="rounded-[6px] border border-rem/30 px-3 py-2 font-sans text-[12px] text-rem">
          {{ templateDialogError }}
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="h-8 rounded-[6px] px-3 font-sans text-[12px] text-ink-2 hover:bg-chrome-mid" @click="clearTemplateDialog">
            Cancel
          </button>
          <button
            type="submit"
            data-testid="app-template-create"
            class="flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 font-sans text-[12px] font-semibold text-accent-ink hover:bg-accent-2 disabled:opacity-50"
            :disabled="!canCreateTemplateApp || actionBusy === 'create-template-app'"
          >
            <IconPlus :size="14" :stroke-width="2" />
            <span>Create app</span>
          </button>
        </div>
      </form>
    </MimDialog>

    <MimDialog :open="sourceDialogOpen" title="Add app source" size="md" @close="clearSourceDialog">
      <div class="flex flex-col gap-3 p-4">
        <label class="flex flex-col gap-1">
          <span class="font-sans text-[11px] font-semibold text-ink-2">Local folder</span>
          <div class="flex gap-2">
            <input
              v-model="sourceFolder"
              data-testid="app-source-folder"
              class="h-8 min-w-0 flex-1 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
              placeholder="/path/to/app-source"
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
              data-testid="app-source-id"
              class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
              placeholder="team"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="font-sans text-[11px] font-semibold text-ink-2">Label</span>
            <input
              v-model="sourceName"
              data-testid="app-source-name"
              class="h-8 rounded-[6px] border border-rule-light bg-chrome-mid px-2 font-sans text-[12px] text-ink outline-none focus:border-accent"
              placeholder="Team apps"
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="app-source-inspect"
          class="flex h-8 w-fit items-center gap-1.5 rounded-[6px] border border-rule bg-surface px-3 font-sans text-[12px] font-semibold text-ink hover:bg-chrome-high disabled:opacity-50"
          :disabled="!sourceFolder.trim() || sourceBusy === 'inspect'"
          @click="inspectAppSource"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <span>Review</span>
        </button>
        <div v-if="sourceDialogError" data-testid="app-source-error" class="rounded-[6px] border border-rem/30 px-3 py-2 font-sans text-[12px] text-rem">
          {{ sourceDialogError }}
        </div>
        <div v-if="sourceReview" data-testid="app-source-review" class="rounded-[8px] border border-rule-light bg-chrome-mid p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="font-sans text-[12px] font-semibold text-ink">{{ sourceReview.name || sourceReview.id }}</div>
              <p class="font-sans text-[11px] text-ink-3">{{ sourceReview.appCount }} {{ sourceReview.appCount === 1 ? 'app' : 'apps' }} found</p>
            </div>
          </div>
          <div v-if="sourceReview.apps.length" class="mt-2 flex flex-col gap-1">
            <div
              v-for="app in sourceReview.apps"
              :key="app.id"
              class="flex items-center justify-between gap-2 text-[11px]"
            >
              <span class="truncate font-medium text-ink">{{ app.name }}</span>
              <span class="shrink-0 font-mono text-[10px] text-ink-4">{{ app.version }}</span>
            </div>
          </div>
          <p v-if="!sourceReview.apps.length && sourceReview.status === 'missing'" class="mt-2 font-sans text-[11px] text-ink-3">
            No index.json found in this folder. The folder needs an index.json with a packages array.
          </p>
          <div v-if="sourceReview.diagnostics.length" class="mt-2 flex flex-col gap-1">
            <p v-for="message in sourceReview.diagnostics" :key="message" class="font-sans text-[11px] text-rem">
              {{ message }}
            </p>
          </div>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="h-8 rounded-[6px] px-3 font-sans text-[12px] text-ink-2 hover:bg-chrome-mid" @click="clearSourceDialog">
              Cancel
            </button>
            <button
              type="button"
              data-testid="app-source-confirm"
              class="h-8 rounded-[6px] bg-accent px-3 font-sans text-[12px] font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
              :disabled="sourceBusy === 'add' || !sourceReview?.apps.length"
              @click="confirmAddSource"
            >
              Add source
            </button>
          </div>
        </div>
      </div>
    </MimDialog>
  </div>
</template>
