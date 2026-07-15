<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue'
import {
  IconActivity,
  IconArchive,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconHistory,
  IconLayoutSidebarLeftCollapse,
  IconMessage,
  IconPlus,
  IconRepeat,
  IconSettings,
  IconTerminal2,
} from '@tabler/icons-vue'
import { NAVIGATOR_SPINE_WIDTH } from '../../services/workbench/entries.js'
import { shortcutLabel } from '../../services/shortcutLabels.js'
import { useSessionStore, type Session, type SessionStatusKind } from '../../stores/sessions.js'
import { useAgentsStore, type DetectedAgent } from '../../stores/agents.js'
import { useAppAgentsStore, type AppAgent } from '../../stores/appAgents.js'
import { useAppsStore } from '../../stores/coreApps.js'
import { useSettingsStore } from '../../stores/settings.js'
import { useRunsStore, type NavigatorRun } from '../../stores/runs.js'
import { usePingsStore } from '../../stores/pings.js'
import {
  defaultWorkPackageView,
  packageWorkEntryId,
  type PackageViewDefinition,
} from '../../services/workbench/packageViews.js'
import { downloadSessionExport } from '../../services/sessionExport.js'
import SessionRow from './SessionRow.vue'
import SessionContextMenu from './SessionContextMenu.vue'
import RunRow from './RunRow.vue'
import RunContextMenu from './RunContextMenu.vue'
import BatchContextMenu from './BatchContextMenu.vue'
import WorkspaceSwitcher from './WorkspaceSwitcher.vue'
import { applyManualOrder, sortWithManualOrder } from './sidebarOrdering.js'
import { initialsFrom, runStatusDotClass, runStatusTag, sessionDotClass, sessionStatusTag } from './sidebarStatus.js'
import { usePointerReorder } from './usePointerReorder.js'
import { isImageIcon, packageIconUrl } from './packageIcon.js'
import { agentIconUrl } from './agentIcon.js'
import MimDialog from '../ui/MimDialog.vue'
import MimMenu from '../ui/MimMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import WorkingIcon from '../ui/WorkingIcon.vue'

interface LoadedPackage {
  manifest: { id: string; name: string; icon?: string; views?: PackageViewDefinition[] }
  dir: string
  source: string
}

// 'run' rows carry a NavigatorRun whose own kind decides where clicks and
// commands route.
type ActivityRow =
  | { key: string; kind: 'chat'; session: Session }
  | { key: string; kind: 'run'; run: NavigatorRun }

// Core platform surfaces: a fixed cluster above the Apps section. Not
// draggable, no section header — these are fixtures, not installed apps.
interface SurfaceRow {
  key: 'chat' | 'routines' | 'files' | 'trust' | 'terminal'
  label: string
  selectWorkId: string
}

// Package rows are destinations (their package view lights up as active);
// agent rows are pure launchers — every click spawns a new session.
// package-agent rows are app-mounted agents from installed packages.
type AppRow =
  | { key: string; kind: 'package'; pkg: LoadedPackage }
  | { key: string; kind: 'agent'; agent: DetectedAgent }
  | { key: string; kind: 'package-agent'; mount: AppAgent }

type ActivityCreateAgentTarget = {
  key: string
  agentId: string
  label: string
}

type ActivityCreatePackageTarget = {
  key: string
  packageId: string
  label: string
  mark: string
}

const props = defineProps<{
  width: number
  collapsed?: boolean
  packages: LoadedPackage[]
  activeWorkId: string
  workspaceName: string | null
  recentWorkspaces: Array<{ path: string; name: string }>
  port?: number
}>()

const emit = defineEmits<{
  toggle: []
  selectWork: [id: string]
  selectSession: [id: string]
  archiveSession: [id: string]
  deleteSession: [id: string]
  selectPackageRun: [packageId: string, runId: string]
  archivePackageRun: [packageId: string, runId: string]
  deletePackageRun: [packageId: string, runId: string]
  launchAgent: [agentId: string]
  selectPackageAgent: [agentId: string]
  selectAgentSession: [agentId: string, sessionId: string]
  archiveAgentSession: [sessionId: string]
  deleteAgentSession: [sessionId: string]
  stopAgentSession: [sessionId: string]
  stopSubagentSession: [sessionId: string]
  openFolder: []
  openRecentWorkspace: [path: string]
  addProject: [mode: 'new' | 'clone']
  manageApps: []
  settings: [section?: 'apps']
  resize: [e: PointerEvent]
}>()

// Collapsed = thin icon rail; expanded = label tray (stored width).
const effectiveWidth = computed(() => (props.collapsed ? NAVIGATOR_SPINE_WIDTH : props.width))

const sessionStore = useSessionStore()
const agentsStore = useAgentsStore()
const appAgentsStore = useAppAgentsStore()
const appsStore = useAppsStore()
const settingsStore = useSettingsStore()
const runsStore = useRunsStore()
// Instantiated here so the ping watcher is live whenever the Navigator is —
// the chime must fire even while the pinged row is off-screen.
const pingsStore = usePingsStore()
const HIDDEN_NAVIGATOR_PACKAGE_IDS = new Set(['hello', 'runtime-demo'])

// A package is launchable iff it has a view AND the resolved state says it is
// visible. Disabled packages are hidden from launchers (spec: one model).
const launchablePackages = computed(() =>
  props.packages.filter(pkg =>
    !!defaultWorkPackageView(pkg) && appsStore.isPackageVisible(pkg.manifest.id),
  ),
)

const launchablePackageById = computed(() =>
  new Map(launchablePackages.value.map(pkg => [pkg.manifest.id, pkg])),
)

const SURFACE_ICONS: Record<SurfaceRow['key'], typeof IconMessage> = {
  chat: IconMessage,
  routines: IconRepeat,
  files: IconFolder,
  trust: IconActivity,
  terminal: IconTerminal2,
}

const SURFACE_ROWS: SurfaceRow[] = [
  {
    key: 'chat',
    label: 'Chat',
    selectWorkId: '__chat__',
  },
  {
    key: 'routines',
    label: 'Routines',
    selectWorkId: '__routines__',
  },
  {
    key: 'files',
    label: 'Files',
    selectWorkId: '__files__',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    selectWorkId: '__terminal__',
  },
  {
    key: 'trust',
    label: 'Monitor',
    selectWorkId: '__activity_trust__',
  },
]

// Launchable packages keep loader order, detected CLI agents come last,
// app-mounted agents follow. Manual order (plain package/agent ids — the
// catalogs cannot collide: agent ids are fixed catalog ids, app agent ids
// are package-namespaced) overrides the whole sequence.
const appRows = computed<AppRow[]>(() => {
  const visible = launchablePackages.value
    .filter(pkg => !HIDDEN_NAVIGATOR_PACKAGE_IDS.has(pkg.manifest.id))
  // Every mounted agent gets a row: the app row opens the app's UI, the agent
  // row opens its chat. For headless agent-only apps the agent row is the
  // app's only presence.
  const packageAgentRows = appAgentsStore.agents
    .map(mount => ({ key: mount.id, kind: 'package-agent' as const, mount }))
  return applyManualOrder(
    [
      ...visible.map(pkg => ({ key: pkg.manifest.id, kind: 'package' as const, pkg })),
      ...agentsStore.enabledAgents.map(agent => ({ key: agent.id, kind: 'agent' as const, agent })),
      ...packageAgentRows,
    ],
    settingsStore.navigatorAppOrder,
  )
})

const activityRows = computed<ActivityRow[]>(() => {
  const sessionRuns = runsStore.chatRuns.filter(run => run.kind === 'routine' || run.kind === 'subagent')
  const rows: (ActivityRow & { ts: number })[] = [
    ...sessionStore.visibleSessions.filter(session => !session.routineId && !session.subagent).map(session => ({
      key: activityKeyForSession(session.id),
      kind: 'chat' as const,
      session,
      ts: new Date(session.updatedAt).getTime(),
    })),
    ...[...sessionRuns, ...runsStore.packageJobRuns, ...runsStore.agentSessionRuns].map(run => ({
      key: activityKeyForRun(run),
      kind: 'run' as const,
      run,
      ts: run.updatedAt ? new Date(run.updatedAt).getTime() : 0,
    })),
  ]
  rows.sort((a, b) => b.ts - a.ts)
  return sortWithManualOrder(rows, settingsStore.navigatorActivityOrder)
})

const appsCollapsed = ref(false)
const activityCollapsed = ref(false)

// The cluster rule is functional: it darkens only while list rows are
// actually disappearing beneath it.
const listScrolled = ref(false)
function onListScroll(event: Event) {
  listScrolled.value = (event.target as HTMLElement).scrollTop > 0
}

// ---- Row refs for context-menu rename ----
const sessionRowRefs = ref<Record<string, InstanceType<typeof SessionRow>>>({})
function setRowRef(id: string, el: any) {
  if (el) sessionRowRefs.value[id] = el
  else delete sessionRowRefs.value[id]
}

const runRowRefs = ref<Record<string, InstanceType<typeof RunRow>>>({})
function setRunRowRef(id: string, el: any) {
  if (el) runRowRefs.value[id] = el
  else delete runRowRefs.value[id]
}

// ---- Status helpers (presentation mapping lives in sidebarStatus.ts) ----
function statusKind(session: Session): SessionStatusKind {
  return sessionStore.sessionStatusKind(session)
}

function statusTag(session: Session): string | null {
  return sessionStatusTag(statusKind(session), sessionStore.isJustFinished(session.id))
}

function packageRunWorkId(run: NavigatorRun): string {
  return `work:package-run:${run.packageId}:${run.sourceId}`
}

// Mirrors agentSessionWorkEntry() — identity is the session id alone.
function agentSessionWorkId(run: NavigatorRun): string {
  return `work:agent-session:${run.sourceId}`
}

// The NavigatorRun for an agent session does not carry the agent id; open
// intents need it, so resolve it from the session record in the runs store.
function agentIdForSession(sessionId: string): string {
  return runsStore.agentSessions.find(item => item.sessionId === sessionId)?.agentId ?? ''
}

// Live pty states — the only states where Stop applies and Delete does not.
// 'done' (RunStatus) is excluded because it's shared with record-level done
// (process exited); the brief runtime-done window (< 5s) still shows Archive
// in the AgentSessionView header.
function agentRunIsLive(run: NavigatorRun): boolean {
  return run.kind === 'agent-session' && (run.status === 'working' || run.status === 'needs-input' || run.status === 'idle')
}

// ---- Collapsed-rail monograms ----
const workspaceMonogram = computed(() => initialsFrom(props.workspaceName ?? ''))

function activityMonogram(row: ActivityRow): string {
  if (row.kind === 'chat') {
    // Sessions bound to an app agent show the agent's name monogram so the
    // collapsed rail groups all conversations with the same agent visually.
    if (row.session.agentId) {
      const mount = appAgentsStore.byId(row.session.agentId)
      if (mount) return initialsFrom(mount.name)
    }
    return initialsFrom(row.session.label)
  }
  return initialsFrom(row.run.title)
}

function activityRowTitle(row: ActivityRow): string {
  if (row.kind === 'chat') {
    const tag = statusTag(row.session)
    return tag ? `${row.session.label} · ${tag}` : row.session.label
  }
  const tag = runStatusTag(row.run.status)
  return tag ? `${row.run.title} · ${tag}` : row.run.title
}

function activityRowActive(row: ActivityRow): boolean {
  if (row.kind === 'chat') return props.activeWorkId === `work:chat:${row.session.id}`
  if (row.run.kind === 'routine' || row.run.kind === 'subagent') return props.activeWorkId === `work:chat:${row.run.sourceId}`
  if (row.run.kind === 'agent-session') return props.activeWorkId === agentSessionWorkId(row.run)
  return props.activeWorkId === packageRunWorkId(row.run)
}

function isCreateTargetStatus(status: NavigatorRun['status']): boolean {
  return status === 'working'
    || status === 'needs-input'
    || status === 'idle'
    || status === 'needs-approval'
    || status === 'error'
    || status === 'paused'
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function agentTargetName(agentId: string, fallback?: string): string {
  const detected = agentsStore.agents.find(agent => agent.id === agentId)
  return detected?.name ?? fallback ?? titleFromId(agentId)
}

function packageTargetMark(pkg: LoadedPackage): string {
  const icon = pkg.manifest.icon
  if (icon && !isImageIcon(icon)) return icon
  return initialsFrom(pkg.manifest.name).slice(0, 1) || pkg.manifest.id.slice(0, 1).toUpperCase()
}

const activityCreateAgentTargets = computed<ActivityCreateAgentTarget[]>(() => {
  const byId = new Map<string, string>()
  for (const agent of agentsStore.enabledAgents) byId.set(agent.id, agent.name)
  for (const row of activityRows.value) {
    if (row.kind !== 'run' || row.run.kind !== 'agent-session') continue
    if (!activityRowActive(row) && !isCreateTargetStatus(row.run.status)) continue
    const agentId = agentIdForSession(row.run.sourceId)
    if (agentId && !byId.has(agentId)) byId.set(agentId, agentTargetName(agentId, row.run.title))
  }
  return [...byId.entries()].map(([agentId, name]) => ({
    key: `agent:${agentId}`,
    agentId,
    label: name,
  }))
})

const activityCreatePackageTargets = computed<ActivityCreatePackageTarget[]>(() => {
  const seen = new Set<string>()
  const targets: ActivityCreatePackageTarget[] = []
  for (const row of activityRows.value) {
    if (row.kind !== 'run' || row.run.kind !== 'package-job' || !row.run.packageId) continue
    if (!activityRowActive(row) && !isCreateTargetStatus(row.run.status)) continue
    if (seen.has(row.run.packageId)) continue
    const pkg = launchablePackageById.value.get(row.run.packageId)
    if (!pkg) continue
    seen.add(row.run.packageId)
    targets.push({
      key: `package:${row.run.packageId}`,
      packageId: row.run.packageId,
      label: pkg.manifest.name,
      mark: packageTargetMark(pkg),
    })
  }
  return targets
})

const activityCreateHasMenu = computed(() =>
  activityCreateAgentTargets.value.length > 0 || activityCreatePackageTargets.value.length > 0,
)

function openNewChat() {
  emit('selectWork', '__chat__')
}

function activityCreateAgentAttrs(target: ActivityCreateAgentTarget): Record<string, string> {
  return {
    'data-testid': `activity-create-agent-${target.agentId}`,
    title: `New ${target.label} session`,
  }
}

function activityCreatePackageAttrs(target: ActivityCreatePackageTarget): Record<string, string> {
  return {
    'data-testid': `activity-create-package-${target.packageId}`,
    title: `Open ${target.label}`,
  }
}

// A small status dot overlays the monogram so running/needs-attention items
// remain legible without their label. Empty string = no dot.
function activityDotClass(row: ActivityRow): string {
  // A fired ping outranks the ordinary dot so the collapsed rail shows which
  // monogram just finished.
  const pinged = pingsStore.settledOutcome(row.key)
  if (pinged) return pinged === 'error' ? 'bg-rem' : 'bg-accent'
  if (row.kind === 'run') return runStatusDotClass(row.run.status)
  return sessionDotClass(statusKind(row.session), sessionStore.isJustFinished(row.session.id))
}

function activityRowWorking(row: ActivityRow): boolean {
  if (row.kind === 'run') return row.run.status === 'working'
  return statusKind(row.session) === 'working'
}

function selectActivityRow(row: ActivityRow) {
  // Opening the row acknowledges a fired ping; the bell returns to its quiet
  // armed state.
  if (!suppressActivityClick.value) pingsStore.clearSettled(row.key)
  if (row.kind === 'chat') selectSession(row.session.id)
  else selectRun(row.run)
}

// ---- Multi-select (expanded tray only) ----
// Cmd/Ctrl-click toggles, Shift-click selects a range from the anchor, plain
// click clears and navigates. Selection marks rows for batch archive/delete
// through the context menu; it never changes the active Work.
const selectedActivityKeys = ref(new Set<string>())
const selectionAnchorKey = ref<string | null>(null)

function clearActivitySelection() {
  selectedActivityKeys.value.clear()
  selectionAnchorKey.value = null
}

function handleActivityRowClick(row: ActivityRow, event: MouseEvent) {
  if (suppressActivityClick.value) return
  if (event.metaKey || event.ctrlKey) {
    if (selectedActivityKeys.value.has(row.key)) selectedActivityKeys.value.delete(row.key)
    else selectedActivityKeys.value.add(row.key)
    selectionAnchorKey.value = row.key
    return
  }
  if (event.shiftKey && selectionAnchorKey.value) {
    const keys = activityRows.value.map(r => r.key)
    const from = keys.indexOf(selectionAnchorKey.value)
    const to = keys.indexOf(row.key)
    if (from >= 0 && to >= 0) {
      selectedActivityKeys.value = new Set(keys.slice(Math.min(from, to), Math.max(from, to) + 1))
      return
    }
  }
  clearActivitySelection()
  selectionAnchorKey.value = row.key
  selectActivityRow(row)
}

const selectedActivityRows = computed(() =>
  activityRows.value.filter(row => selectedActivityKeys.value.has(row.key)),
)

function onSelectionKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && selectedActivityKeys.value.size) clearActivitySelection()
}

function selectRun(run: NavigatorRun) {
  if (suppressActivityClick.value) return
  if (run.kind === 'routine' || run.kind === 'subagent') {
    selectSession(run.sourceId)
  } else if (run.kind === 'package-job' && run.packageId) {
    emit('selectPackageRun', run.packageId, run.sourceId)
  } else if (run.kind === 'agent-session') {
    emit('selectAgentSession', agentIdForSession(run.sourceId), run.sourceId)
  }
}

function appRowActive(row: AppRow): boolean {
  // Agent rows (CLI and package-agent) are launchers, not destinations —
  // never active. The launched session's Activity row carries the active state.
  if (row.kind === 'agent' || row.kind === 'package-agent') return false
  return props.activeWorkId === packageWorkEntryId(row.pkg)
}

// Core surfaces are launchers, but the live host should still read as "you are
// here" — the one tray signal that confirms which surface is active. Chat
// covers both the draft (`work:chat:new`) and any open session.
function surfaceActive(row: SurfaceRow): boolean {
  if (row.key === 'chat') return props.activeWorkId.startsWith('work:chat:')
  if (row.key === 'routines') return props.activeWorkId === 'work:routines'
  if (row.key === 'files') return props.activeWorkId === 'work:files'
  if (row.key === 'terminal') return props.activeWorkId === 'work:terminal'
  return props.activeWorkId === 'work:activity-trust'
}

function appRowName(row: AppRow): string {
  if (row.kind === 'package') return row.pkg.manifest.name
  if (row.kind === 'agent') return row.agent.name
  return row.mount.name
}

function selectAppRow(row: AppRow) {
  if (suppressAppClick.value) return
  if (row.kind === 'agent') emit('launchAgent', row.agent.id)
  else if (row.kind === 'package-agent') emit('selectPackageAgent', row.mount.id)
  else emit('selectWork', row.pkg.manifest.id)
}

function activityKeyForSession(sessionId: string): string {
  return `chat:${sessionId}`
}

function activityKeyForRun(run: NavigatorRun): string {
  return run.id
}

// ---- Select session ----
function selectSession(id: string) {
  if (suppressActivityClick.value) return
  sessionStore.select(id)
  emit('selectSession', id)
}

// ---- Context menus ----
const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  session: null as Session | null,
})

const runCtxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  run: null as NavigatorRun | null,
})

const batchCtxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})

// A right-click inside a multi-selection opens the batch menu; outside it
// drops the selection and opens the normal single-row menu (Finder rule).
function openBatchMenuFor(event: MouseEvent, key: string): boolean {
  if (selectedActivityKeys.value.size > 1 && selectedActivityKeys.value.has(key)) {
    batchCtxMenu.x = event.clientX
    batchCtxMenu.y = event.clientY
    batchCtxMenu.visible = true
    return true
  }
  clearActivitySelection()
  return false
}

function closeBatchMenu() {
  batchCtxMenu.visible = false
}

function batchArchive() {
  const rows = selectedActivityRows.value
  closeBatchMenu()
  clearActivitySelection()
  for (const row of rows) {
    if (row.kind === 'chat') emit('archiveSession', row.session.id)
    else if (row.run.kind === 'routine' || row.run.kind === 'subagent') emit('archiveSession', row.run.sourceId)
    else if (row.run.kind === 'agent-session') emit('archiveAgentSession', row.run.sourceId)
    else if (row.run.packageId) emit('archivePackageRun', row.run.packageId, row.run.sourceId)
  }
}

function batchDelete() {
  const rows = selectedActivityRows.value
  closeBatchMenu()
  clearActivitySelection()
  for (const row of rows) {
    if (row.kind === 'chat') emit('deleteSession', row.session.id)
    else if (row.run.kind === 'routine' || row.run.kind === 'subagent') emit('deleteSession', row.run.sourceId)
    else if (row.run.kind === 'agent-session') {
      // Running sessions cannot be deleted (stop first); skip them silently
      // rather than surface a main-process error mid-batch.
      if (!agentRunIsLive(row.run)) emit('deleteAgentSession', row.run.sourceId)
    }
    else if (row.run.packageId) emit('deletePackageRun', row.run.packageId, row.run.sourceId)
  }
}

function openContextMenu(event: MouseEvent, session: Session) {
  if (openBatchMenuFor(event, activityKeyForSession(session.id))) return
  ctxMenu.x = event.clientX
  ctxMenu.y = event.clientY
  ctxMenu.session = session
  ctxMenu.visible = true
}

function closeContextMenu() {
  ctxMenu.visible = false
  ctxMenu.session = null
}

function openRunContextMenu(event: MouseEvent, run: NavigatorRun) {
  if (openBatchMenuFor(event, activityKeyForRun(run))) return
  runCtxMenu.x = event.clientX
  runCtxMenu.y = event.clientY
  runCtxMenu.run = run
  runCtxMenu.visible = true
}

function closeRunContextMenu() {
  runCtxMenu.visible = false
  runCtxMenu.run = null
}

// Stop applies only to live agent sessions; Delete is withheld from them
// until the pty has ended (stop first, then delete).
const runCtxIsLiveAgent = computed(() => !!runCtxMenu.run && agentRunIsLive(runCtxMenu.run))
const runCtxIsLiveSubagent = computed(() => {
  const run = runCtxMenu.run
  return !!run && run.kind === 'subagent' && ['working', 'waiting', 'needs-approval'].includes(run.status)
})
const runCtxCanStop = computed(() => runCtxIsLiveAgent.value || runCtxIsLiveSubagent.value)

const ctxPingArmed = computed(() =>
  !!ctxMenu.session && pingsStore.isArmed(activityKeyForSession(ctxMenu.session.id)),
)
const runCtxPingArmed = computed(() => !!runCtxMenu.run && pingsStore.isArmed(runCtxMenu.run.id))

function onCtxTogglePing() {
  const session = ctxMenu.session
  closeContextMenu()
  if (session) pingsStore.toggle(activityKeyForSession(session.id))
}

function onRunCtxTogglePing() {
  const run = runCtxMenu.run
  closeRunContextMenu()
  if (run) pingsStore.toggle(run.id)
}

function onRunCtxRename() {
  const run = runCtxMenu.run
  closeRunContextMenu()
  if (run?.kind === 'package-job' || run?.kind === 'agent-session') {
    nextTick(() => runRowRefs.value[run.sourceId]?.startRename())
  }
}

function onRunCtxArchive() {
  const run = runCtxMenu.run
  closeRunContextMenu()
  if (run?.kind === 'agent-session') {
    emit('archiveAgentSession', run.sourceId)
  } else if (run?.kind === 'routine' || run?.kind === 'subagent') {
    emit('archiveSession', run.sourceId)
  } else if (run?.kind === 'package-job' && run.packageId) {
    emit('archivePackageRun', run.packageId, run.sourceId)
  }
}

function onRunCtxDelete() {
  const run = runCtxMenu.run
  closeRunContextMenu()
  if (run?.kind === 'agent-session') {
    emit('deleteAgentSession', run.sourceId)
  } else if (run?.kind === 'routine' || run?.kind === 'subagent') {
    emit('deleteSession', run.sourceId)
  } else if (run?.kind === 'package-job' && run.packageId) {
    emit('deletePackageRun', run.packageId, run.sourceId)
  }
}

function onRunCtxStop() {
  const run = runCtxMenu.run
  closeRunContextMenu()
  if (run?.kind === 'agent-session') {
    emit('stopAgentSession', run.sourceId)
  } else if (run?.kind === 'subagent') {
    emit('stopSubagentSession', run.sourceId)
  }
}

function onCtxRename() {
  if (!ctxMenu.session) return
  const session = ctxMenu.session
  closeContextMenu()
  nextTick(() => {
    const rowComp = sessionRowRefs.value[session.id]
    rowComp?.startRename()
  })
}

function onCtxExport() {
  if (!ctxMenu.session) return
  const session = ctxMenu.session
  closeContextMenu()
  downloadSessionExport(session)
}

function onCtxArchive() {
  if (!ctxMenu.session) return
  const sessionId = ctxMenu.session.id
  closeContextMenu()
  emit('archiveSession', sessionId)
}

function onCtxDelete() {
  if (!ctxMenu.session) return
  const sessionId = ctxMenu.session.id
  closeContextMenu()
  emit('deleteSession', sessionId)
}

// ---- Rename handler (from SessionRow emit) ----
function handleRenameCommit(patchedSession: Session) {
  sessionStore.rename(patchedSession.id, patchedSession.label)
}

// ---- Undo ----
function onUndo() {
  sessionStore.undoLast()
}

// ---- Archive all ----
const archiveAllDialogOpen = ref(false)

function activityRowIsLive(row: ActivityRow): boolean {
  if (activityRowActive(row)) return true
  if (row.kind === 'chat') {
    const kind = statusKind(row.session)
    return kind === 'working' || kind === 'error' || kind === 'needs-approval' || kind === 'unread'
  }
  const s = row.run.status
  return s === 'working' || s === 'waiting' || s === 'needs-input' || s === 'idle' || s === 'needs-approval' || s === 'error' || s === 'paused'
}

const archivableRows = computed(() =>
  activityRows.value.filter(row => !activityRowIsLive(row)),
)

function confirmArchiveAll() {
  archiveAllDialogOpen.value = false
  for (const row of archivableRows.value) {
    if (row.kind === 'chat') emit('archiveSession', row.session.id)
    else if (row.run.kind === 'routine' || row.run.kind === 'subagent') emit('archiveSession', row.run.sourceId)
    else if (row.run.kind === 'agent-session') emit('archiveAgentSession', row.run.sourceId)
    else if (row.run.packageId) emit('archivePackageRun', row.run.packageId, row.run.sourceId)
  }
}

// ---- Pointer-based drag and drop ----
const {
  drag: appDrag,
  dropIndicator: appDropIndicator,
  dragging: appDragging,
  suppressClick: suppressAppClick,
  onPointerDown: onAppPointerDown,
} = usePointerReorder({
  rowSelector: '.sb .app-list [data-app-key]',
  keyAttr: 'appKey',
  keys: () => appRows.value.map(row => row.key),
  onReorder: reordered => settingsStore.set('navigatorAppOrder', reordered),
})

const {
  drag: activityDrag,
  dropIndicator: activityDropIndicator,
  dragging: activityDragging,
  suppressClick: suppressActivityClick,
  onPointerDown: onActivityPointerDown,
} = usePointerReorder({
  rowSelector: '.sb .activity-list [data-activity-key]',
  keyAttr: 'activityKey',
  keys: () => activityRows.value.map(row => row.key),
  onReorder: (reordered) => {
    settingsStore.set('navigatorActivityOrder', reordered)
    const chatOrder = reordered
      .filter(key => key.startsWith('chat:'))
      .map(key => key.slice('chat:'.length))
    sessionStore.reorder(chatOrder)
  },
})

const draggingActive = computed(() => appDragging.value || activityDragging.value)

function onSessionRowPointerDown(event: PointerEvent, session: Session) {
  onActivityPointerDown(event, activityKeyForSession(session.id))
}

// ---- Workspace change → reload sessions ----
watch(() => props.workspaceName, () => {
  clearActivitySelection()
  sessionStore.load()
})

// ---- Lifecycle ----
onMounted(() => {
  sessionStore.load()
  window.addEventListener('keydown', onSelectionKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onSelectionKeydown)
})
</script>

<template>
  <aside
    class="sb relative flex h-full flex-shrink-0 flex-col overflow-hidden bg-chrome"
    :class="[draggingActive && 'select-none', collapsed ? 'border-r-0' : 'border-r border-rule-light']"
    :style="{ width: effectiveWidth + 'px' }"
    :data-collapsed="collapsed ? 'true' : 'false'"
    aria-label="Sidebar"
  >
    <!-- The Navigator sits one chrome step below pane headers (bg-chrome vs
         bg-chrome-high), so the sidebar reads as a distinct surface from the
         Work/Artifact content areas. Depth comes from the chrome → chrome-high →
         surface gradient plus the border-r hairline. -->
    <!-- Top chrome: expanded owns collapse; collapsed is bridged by the first pane header. -->
    <div
      class="sb-drag-handle shrink-0"
      :class="collapsed ? 'relative h-12' : 'flex h-10 items-center justify-end px-2'"
      :data-testid="collapsed ? 'navigator-bridge-cap' : 'navigator-top-chrome'"
    >
      <button
        v-if="!collapsed"
        type="button"
        class="no-drag flex h-6 w-6 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        :title="`Collapse sidebar (${shortcutLabel(['Mod', 'B'])})`"
        aria-label="Collapse sidebar"
        data-testid="navigator-collapse"
        @click.stop="emit('toggle')"
      >
        <IconLayoutSidebarLeftCollapse :size="14" :stroke="1.9" />
      </button>
    </div>

    <!-- Header cluster: the workspace switcher and the core surfaces sit
         flat on the chrome like every other row — grouped by proximity and
         the single full-bleed rule below, which is where scrolling begins.
         Pinned above the scroll list so core surfaces never scroll away.
         Rem-true mirror against the rail (root font is 14px, so pixel
         literals drift — every equation below must keep holding):
         · chip y: chrome 2.5rem + ws pt-2 + the h-9 row's 0.25rem chip
           centering equals the rail's cap 3rem + mark pt-1.
         · first core token: chrome 2.5rem + ws row (pt-2 + h-9 = 2.75rem)
           + core pt-5 equals the rail's cap 3rem + mark h-11 + list pt-3.
         · Apps marker: core pb-2 + 1px rule + Apps mt (0.75rem − 1px)
           equals the rail's mt-5. -->
    <div v-if="!collapsed" class="shrink-0 px-3 pt-2" data-testid="workspace-row">
      <WorkspaceSwitcher
        :workspace-name="workspaceName"
        :recent-workspaces="recentWorkspaces"
        :monogram="workspaceMonogram"
        @open-folder="emit('openFolder')"
        @open-recent-workspace="path => emit('openRecentWorkspace', path)"
        @add-project="mode => emit('addProject', mode)"
      />
    </div>
    <div
      v-if="!collapsed"
      class="core-surface-list flex shrink-0 flex-col gap-px pr-3 pl-2 pt-5 pb-2"
      data-testid="core-surfaces"
    >
      <button
        v-for="row in SURFACE_ROWS"
        :key="row.key"
        class="group/navrow flex w-full items-center overflow-hidden rounded-[7px] py-px pl-1 text-left text-[12.5px] hover:bg-chrome-mid"
        :class="surfaceActive(row) ? 'bg-accent-tint' : ''"
        :data-work-key="row.key"
        :data-active="surfaceActive(row) ? 'true' : undefined"
        :title="row.label"
        :aria-label="row.label"
        @click="emit('selectWork', row.selectWorkId)"
      >
        <span class="nav-token grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[13px] leading-none" :class="surfaceActive(row) ? 'text-accent' : 'text-ink-3'">
          <component :is="SURFACE_ICONS[row.key]" :size="16" :stroke="1.8" />
        </span>
        <span
          class="ml-1 min-w-0 flex-1 truncate pr-2 text-left"
          :class="surfaceActive(row) ? 'text-ink font-medium' : 'text-ink-2'"
        >{{ row.label }}</span>
      </button>
    </div>
    <!-- The one drawn line in the tray: marks where the pinned cluster ends
         and the scroll region begins; sharpens while rows pass beneath it. -->
    <div
      v-if="!collapsed"
      class="shrink-0 border-t"
      :class="listScrolled ? 'border-rule' : 'border-rule-light'"
      data-testid="core-rule"
      aria-hidden="true"
    />
    <!-- Cap (3rem) + mark (h-11) mirrors the expanded top chrome (2.5rem) +
         workspace row (pt-2 + h-9), keeping the monogram and every row below
         at identical y — see the header-cluster equations above. Rem-true on
         purpose: the root font size is 14px, so a pixel-literal height here
         breaks the mirror and jiggles every icon below it on toggle. -->
    <div
      v-if="collapsed"
      class="relative h-11 shrink-0 px-3 pt-1"
      data-testid="workspace-mark"
      :title="workspaceName ?? undefined"
    >
      <span class="grid h-7 w-7 place-items-center rounded-[7px] border border-rule-light bg-chrome-mid font-sans text-[11px] font-semibold leading-none tracking-tight text-ink-2">{{ workspaceMonogram }}</span>
    </div>

    <!-- Navigator list -->
    <div
      class="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-2"
      :class="collapsed ? '' : 'min-h-[80px]'"
      data-testid="navigator-list"
      @scroll.passive="onListScroll"
    >

      <!-- Core surfaces, rail face: token-only rows in the shared list lane.
           The tray renders these in the pinned header cluster instead. -->
      <div v-if="collapsed" class="core-surface-list flex flex-col items-start gap-px pt-3" data-testid="core-surfaces">
        <button
          v-for="row in SURFACE_ROWS"
          :key="row.key"
          class="group/navrow flex h-8 items-center overflow-hidden rounded-[7px] text-left text-[12.5px]"
          :data-work-key="row.key"
          :data-active="surfaceActive(row) ? 'true' : undefined"
          :title="row.label"
          :aria-label="row.label"
          @click="emit('selectWork', row.selectWorkId)"
        >
          <span
            class="nav-token grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[13px] leading-none"
            :class="surfaceActive(row)
              ? 'bg-accent-tint text-accent'
              : 'text-ink-3 group-hover/navrow:bg-chrome-mid group-hover/navrow:text-ink'"
          >
            <component :is="SURFACE_ICONS[row.key]" :size="16" :stroke="1.8" />
          </span>
        </button>
      </div>

      <!-- Apps: installed package launchers. Expanded margin compensates the
           header cluster's pb-2 + 1px rule so the Apps marker holds y on
           toggle (rail keeps mt-5 above its divider). -->
      <section :class="collapsed ? 'mt-5' : 'mt-[calc(0.75rem-1px)]'">
        <!-- Section marker keeps row positions stable in both states. -->
        <div class="flex h-[24px] shrink-0 items-center gap-1" data-testid="section-marker-apps">
          <template v-if="collapsed">
            <div class="h-px w-7 rounded-full bg-rule-light" data-testid="section-divider-apps" aria-hidden="true" />
          </template>
          <template v-else>
            <button
              class="flex h-[24px] flex-1 items-center gap-1 rounded-[5px] px-1 text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
              :aria-expanded="!appsCollapsed"
              data-testid="section-toggle-apps"
              title="Toggle Apps"
              @click="appsCollapsed = !appsCollapsed"
            >
              <IconChevronRight v-if="appsCollapsed" :size="12" :stroke="2" class="shrink-0 text-ink-4" />
              <IconChevronDown v-else :size="12" :stroke="2" class="shrink-0 text-ink-4" />
              <span>Apps</span>
            </button>
            <button
              class="relative flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              title="Manage apps"
              data-testid="manage-apps"
              @click="$emit('manageApps')"
            >
              <IconSettings :size="13" :stroke="1.8" />
              <span
                v-if="appsStore.updateCount > 0"
                data-testid="manage-apps-badge"
                class="absolute -right-px -top-px h-[7px] w-[7px] rounded-full bg-accent ring-2 ring-chrome"
              />
            </button>
          </template>
        </div>

        <div
          v-if="collapsed || !appsCollapsed"
          class="app-list mt-1 flex flex-col items-start gap-px"
          :class="collapsed ? '' : '-ml-1'"
        >
          <template v-for="row in appRows" :key="row.key">
            <div v-if="!collapsed && appDropIndicator?.beforeKey === row.key" class="h-[2px] mx-[6px] bg-accent rounded-[1px] shrink-0" />
            <button
              class="group/navrow flex items-center overflow-hidden rounded-[7px] py-px text-left text-[12.5px]"
              :class="[
                collapsed ? '' : 'w-full pl-1 text-ink-2 hover:bg-chrome-mid',
                !collapsed && appRowActive(row) ? 'bg-accent-tint text-ink font-medium' : '',
                appDrag?.key === row.key && appDrag?.active ? 'opacity-35' : '',
              ]"
              :data-app-key="row.key"
              :data-package-id="row.kind === 'package' ? row.pkg.manifest.id : (row.kind === 'package-agent' ? row.mount.packageId : undefined)"
              :data-agent-id="row.kind === 'agent' ? row.agent.id : (row.kind === 'package-agent' ? row.mount.id : undefined)"
              :title="appRowName(row)"
              :aria-label="appRowName(row)"
              @pointerdown="collapsed ? undefined : onAppPointerDown($event, row.key)"
              @click="selectAppRow(row)"
            >
              <span
                class="nav-token grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[13px] leading-none"
                :class="collapsed
                  ? (appRowActive(row) ? 'bg-accent-tint text-accent' : 'text-ink-3 group-hover/navrow:bg-chrome-mid group-hover/navrow:text-ink')
                  : (appRowActive(row) ? 'text-accent' : 'text-ink-3')"
              >
                <span
                  v-if="row.kind === 'agent' && agentIconUrl(row.agent.id)"
                  class="package-icon-img"
                  :style="{ '--icon-url': `url('${agentIconUrl(row.agent.id)}')` }"
                  :aria-hidden="true"
                />
                <span
                  v-else-if="row.kind === 'package' && isImageIcon(row.pkg.manifest.icon) && port"
                  class="package-icon-img"
                  :style="{ '--icon-url': `url('${packageIconUrl(row.pkg.manifest.icon!, row.pkg.manifest.id, port)}')` }"
                  :aria-hidden="true"
                />
                <span
                  v-else-if="row.kind === 'package-agent' && row.mount.icon && isImageIcon(row.mount.icon) && port"
                  class="package-icon-img"
                  :style="{ '--icon-url': `url('${packageIconUrl(row.mount.icon, row.mount.packageId, port)}')` }"
                  :aria-hidden="true"
                />
                <template v-else-if="row.kind === 'package-agent'">{{ row.mount.icon && !isImageIcon(row.mount.icon) ? row.mount.icon : initialsFrom(row.mount.name).slice(0, 1) || '◻' }}</template>
                <template v-else-if="row.kind === 'package'">{{ row.pkg.manifest.icon ?? '◻' }}</template>
                <template v-else>◻</template>
              </span>
              <span v-if="!collapsed" class="ml-1 min-w-0 flex-1 truncate pr-2 text-left">{{ appRowName(row) }}</span>
              <IconPlus
                v-if="!collapsed && (row.kind === 'agent' || row.kind === 'package-agent')"
                :size="11"
                :stroke-width="2"
                class="shrink-0 mr-1.5 text-ink-4"
              />
            </button>
            <div v-if="!collapsed && appDropIndicator?.afterKey === row.key" class="h-[2px] mx-[6px] bg-accent rounded-[1px] shrink-0" />
          </template>
          <div v-if="!collapsed && !appRows.length" class="px-[6px] py-1 text-[11px] text-ink-4">
            No apps
          </div>
        </div>
      </section>

      <!-- Activity -->
      <section class="mt-5">
        <!-- Section marker keeps row positions stable in both states. The
             marker carries the new-chat affordance in both: header icon when
             expanded, the rail's + token when collapsed (the rail has no room
             for a History token; History stays on the expanded tray). -->
        <div class="flex h-[24px] shrink-0 items-center gap-1" data-testid="section-marker-activity">
          <template v-if="collapsed">
            <button
              v-if="!activityCreateHasMenu"
              class="ml-[3px] grid h-[22px] w-[22px] place-items-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              title="New chat"
              aria-label="New chat"
              data-testid="activity-new-chat"
              @click="openNewChat"
            >
              <IconPlus :size="13" :stroke="1.8" />
            </button>
            <MimMenu
              v-else
              placement="bottom-start"
              aria-label="New activity"
              title="New activity"
              trigger-class="ml-[3px] h-[22px] w-[22px] justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              :trigger-attrs="{ 'data-testid': 'activity-new-chat' }"
              :items-attrs="{ 'data-testid': 'activity-create-menu' }"
              :min-width="210"
              :max-width="260"
            >
              <template #trigger>
                <IconPlus :size="13" :stroke="1.8" />
              </template>
              <MimMenuItem :button-attrs="{ 'data-testid': 'activity-create-chat' }" @select="openNewChat">
                <IconMessage :size="14" :stroke="1.8" class="shrink-0 text-ink-3" />
                <span class="min-w-0 truncate">New chat</span>
              </MimMenuItem>
              <template v-if="activityCreateAgentTargets.length">
                <MimMenuItem
                  v-for="target in activityCreateAgentTargets"
                  :key="target.key"
                  :button-attrs="activityCreateAgentAttrs(target)"
                  @select="emit('launchAgent', target.agentId)"
                >
                  <IconTerminal2 :size="14" :stroke="1.8" class="shrink-0 text-ink-3" />
                  <span class="min-w-0 truncate">{{ target.label }}</span>
                </MimMenuItem>
              </template>
              <div
                v-if="activityCreateAgentTargets.length && activityCreatePackageTargets.length"
                class="my-1 border-t border-rule-light"
                data-testid="activity-create-divider"
              />
              <template v-if="activityCreatePackageTargets.length">
                <MimMenuItem
                  v-for="target in activityCreatePackageTargets"
                  :key="target.key"
                  :button-attrs="activityCreatePackageAttrs(target)"
                  @select="emit('selectWork', target.packageId)"
                >
                  <span class="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-rule-light bg-chrome-mid text-[10px] font-semibold text-ink-2">
                    {{ target.mark }}
                  </span>
                  <span class="min-w-0 truncate">{{ target.label }}</span>
                </MimMenuItem>
              </template>
            </MimMenu>
          </template>
          <template v-else>
            <button
              class="flex h-[24px] flex-1 items-center gap-1 rounded-[5px] px-1 text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
              :aria-expanded="!activityCollapsed"
              data-testid="section-toggle-activity"
              title="Toggle Activity"
              @click="activityCollapsed = !activityCollapsed"
            >
              <IconChevronRight v-if="activityCollapsed" :size="12" :stroke="2" class="shrink-0 text-ink-4" />
              <IconChevronDown v-else :size="12" :stroke="2" class="shrink-0 text-ink-4" />
              <span>Activity</span>
            </button>
            <button
              v-if="archivableRows.length"
              class="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              title="Archive all"
              aria-label="Archive all"
              data-testid="activity-archive-all"
              @click="archiveAllDialogOpen = true"
            >
              <IconArchive :size="13" :stroke="1.8" />
            </button>
            <button
              class="flex h-[22px] w-[22px] items-center justify-center rounded-[5px]"
              :class="activeWorkId === 'work:archive' ? 'bg-accent-tint text-accent' : 'text-ink-3 hover:bg-chrome-mid hover:text-ink'"
              title="History"
              aria-label="History"
              data-testid="activity-history"
              @click="emit('selectWork', '__archive__')"
            >
              <IconHistory :size="13" :stroke="1.8" />
            </button>
            <button
              v-if="!activityCreateHasMenu"
              class="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              title="New chat"
              aria-label="New chat"
              data-testid="activity-new-chat"
              @click="openNewChat"
            >
              <IconPlus :size="13" :stroke="1.8" />
            </button>
            <MimMenu
              v-else
              placement="bottom-end"
              aria-label="New activity"
              title="New activity"
              trigger-class="h-[22px] w-[22px] justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
              :trigger-attrs="{ 'data-testid': 'activity-new-chat' }"
              :items-attrs="{ 'data-testid': 'activity-create-menu' }"
              :min-width="210"
              :max-width="260"
            >
              <template #trigger>
                <IconPlus :size="13" :stroke="1.8" />
              </template>
              <MimMenuItem :button-attrs="{ 'data-testid': 'activity-create-chat' }" @select="openNewChat">
                <IconMessage :size="14" :stroke="1.8" class="shrink-0 text-ink-3" />
                <span class="min-w-0 truncate">New chat</span>
              </MimMenuItem>
              <template v-if="activityCreateAgentTargets.length">
                <MimMenuItem
                  v-for="target in activityCreateAgentTargets"
                  :key="target.key"
                  :button-attrs="activityCreateAgentAttrs(target)"
                  @select="emit('launchAgent', target.agentId)"
                >
                  <IconTerminal2 :size="14" :stroke="1.8" class="shrink-0 text-ink-3" />
                  <span class="min-w-0 truncate">{{ target.label }}</span>
                </MimMenuItem>
              </template>
              <div
                v-if="activityCreateAgentTargets.length && activityCreatePackageTargets.length"
                class="my-1 border-t border-rule-light"
                data-testid="activity-create-divider"
              />
              <template v-if="activityCreatePackageTargets.length">
                <MimMenuItem
                  v-for="target in activityCreatePackageTargets"
                  :key="target.key"
                  :button-attrs="activityCreatePackageAttrs(target)"
                  @select="emit('selectWork', target.packageId)"
                >
                  <span class="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-rule-light bg-chrome-mid text-[10px] font-semibold text-ink-2">
                    {{ target.mark }}
                  </span>
                  <span class="min-w-0 truncate">{{ target.label }}</span>
                </MimMenuItem>
              </template>
            </MimMenu>
          </template>
        </div>

        <!-- Collapsed rail: monogram tokens (instances have no icon) -->
        <div v-if="collapsed && activityRows.length" class="activity-rail mt-1 flex flex-col items-start gap-px">
          <button
            v-for="row in activityRows"
            :key="row.key"
            class="group/navrow flex h-8 items-center"
            :data-activity-key="row.key"
            :data-run-id="row.kind === 'run' ? row.run.id : undefined"
            :title="activityRowTitle(row)"
            :aria-label="activityRowTitle(row)"
            @click="selectActivityRow(row)"
            @contextmenu.prevent="row.kind === 'chat' ? openContextMenu($event, row.session) : openRunContextMenu($event, row.run)"
          >
            <!-- The monogram chip is h-7 (1.75rem) — the same box as the
                 nav-token — so chips and icon tokens share one height down the
                 rail. Left-aligned to the px-3 lane so it sits flush under the
                 tokens; matches the SessionRow/RunRow chip and the workspace
                 mark so nothing resizes on toggle. -->
            <span
              class="relative grid h-7 w-7 place-items-center rounded-[7px] border font-sans text-[11px] font-semibold leading-none tracking-tight"
              :class="activityRowActive(row) ? 'border-accent/40 bg-accent-tint text-accent' : 'border-rule-light bg-chrome-mid text-ink-2 group-hover/navrow:bg-chrome-high group-hover/navrow:text-ink'"
            >
              {{ activityMonogram(row) }}
              <WorkingIcon v-if="activityRowWorking(row)" />
              <span
                v-else-if="activityDotClass(row)"
                class="absolute -right-px -top-px h-[7px] w-[7px] rounded-full ring-2 ring-chrome"
                :class="activityDotClass(row)"
              />
            </span>
          </button>
        </div>

        <!-- Expanded list -->
        <div v-if="!collapsed && !activityCollapsed" class="mt-1">
          <div v-if="activityRows.length" class="activity-list -ml-1 flex flex-col gap-px">
            <template v-for="row in activityRows" :key="row.key">
              <div v-if="activityDropIndicator?.beforeKey === row.key" class="h-[2px] mx-[6px] bg-accent rounded-[1px] shrink-0" />
              <SessionRow
                v-if="row.kind === 'chat'"
                :ref="(el: any) => setRowRef(row.session.id, el)"
                :data-activity-key="row.key"
                :session="row.session"
                :monogram="activityMonogram(row)"
                :active="activeWorkId === `work:chat:${row.session.id}`"
                :selected="selectedActivityKeys.has(row.key)"
                :status-kind="statusKind(row.session)"
                :status-tag="statusTag(row.session)"
                :just-finished="sessionStore.isJustFinished(row.session.id)"
                :dragging="activityDrag?.key === row.key && activityDrag?.active"
                @select="(_id: string, ev: MouseEvent) => handleActivityRowClick(row, ev)"
                @contextmenu="openContextMenu"
                @rename-commit="handleRenameCommit"
                @pointerdown="onSessionRowPointerDown"
              />
              <RunRow
                v-else
                :ref="(el: any) => setRunRowRef(row.run.sourceId, el)"
                :data-activity-key="row.key"
                :run="row.run"
                :active="activityRowActive(row)"
                :selected="selectedActivityKeys.has(row.key)"
                :dragging="activityDrag?.key === row.key && activityDrag?.active"
                @select="(_run: NavigatorRun, ev: MouseEvent) => handleActivityRowClick(row, ev)"
                @contextmenu="openRunContextMenu"
                @pointerdown="onActivityPointerDown($event, row.key)"
              />
              <div v-if="activityDropIndicator?.afterKey === row.key" class="h-[2px] mx-[6px] bg-accent rounded-[1px] shrink-0" />
            </template>
          </div>
          <div v-else class="text-[11px] text-ink-4 px-[6px] py-1">
            No activity
          </div>
        </div>
      </section>
    </div>

    <!-- Footer: Settings only. Collapse lives in the expanded top chrome;
         expand lives in the bridged pane header next to the traffic lights.
         pb-4 keeps the Settings token clear of the flush bottom edge; shared classes keep both states in lockstep. -->
    <footer
      class="relative shrink-0 border-t border-rule-light px-3 pb-3 pt-1.5"
      data-testid="sidebar-footer"
    >
      <button
        class="group/navrow flex h-8 items-center rounded-[7px] text-left font-sans text-[12.5px] text-ink-2"
        :class="collapsed ? '' : 'w-full hover:bg-chrome-mid hover:text-ink'"
        aria-label="Settings"
        title="Settings"
        @click="$emit('settings')"
      >
        <span
          class="nav-token grid h-7 w-7 shrink-0 place-items-center rounded-[7px] leading-none text-ink-3"
          :class="collapsed ? 'group-hover/navrow:bg-chrome-mid group-hover/navrow:text-ink' : ''"
        >
          <IconSettings :size="16" :stroke="1.8" />
        </span>
        <span v-if="!collapsed" class="ml-1 min-w-0 flex-1 truncate pr-2 text-left">Settings</span>
      </button>
    </footer>

    <!-- Session context menu -->
    <SessionContextMenu
      v-if="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :ping-armed="ctxPingArmed"
      @close="closeContextMenu"
      @rename="onCtxRename"
      @export="onCtxExport"
      @toggle-ping="onCtxTogglePing"
      @archive="onCtxArchive"
      @delete="onCtxDelete"
    />

    <!-- Run context menu (package runs and agent sessions) -->
    <RunContextMenu
      v-if="runCtxMenu.visible"
      :x="runCtxMenu.x"
      :y="runCtxMenu.y"
      :can-stop="runCtxCanStop"
      :can-delete="!runCtxCanStop"
      :ping-armed="runCtxPingArmed"
      :can-rename="runCtxMenu.run?.kind !== 'routine' && runCtxMenu.run?.kind !== 'subagent'"
      @close="closeRunContextMenu"
      @rename="onRunCtxRename"
      @stop="onRunCtxStop"
      @toggle-ping="onRunCtxTogglePing"
      @archive="onRunCtxArchive"
      @delete="onRunCtxDelete"
    />

    <!-- Batch context menu (multi-selected Activity rows) -->
    <BatchContextMenu
      v-if="batchCtxMenu.visible"
      :x="batchCtxMenu.x"
      :y="batchCtxMenu.y"
      :count="selectedActivityRows.length"
      @close="closeBatchMenu"
      @archive="batchArchive"
      @delete="batchDelete"
    />

    <!-- Undo toast -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div v-if="sessionStore.undoToast" class="absolute bottom-12 left-2 right-2 flex items-center justify-between px-3 py-2 bg-ink text-surface rounded-[6px] font-sans text-[12px] z-50 shadow-lg">
        <span>{{ sessionStore.undoToast.message }}</span>
        <button v-if="sessionStore.undoToast.snapshot" class="text-accent font-medium text-[12px] hover:opacity-80" @click="onUndo">Undo</button>
      </div>
    </Transition>

    <!-- Archive all confirm -->
    <MimDialog
      v-if="archiveAllDialogOpen"
      :open="true"
      size="sm"
      role="alertdialog"
      title="Archive all activity"
      @close="archiveAllDialogOpen = false"
    >
      <div class="flex flex-col gap-3 px-5 pb-5 font-sans">
        <p class="m-0 text-[13px] text-ink">
          Archive {{ archivableRows.length }} {{ archivableRows.length === 1 ? 'item' : 'items' }}?
        </p>
        <p v-if="activityRows.length !== archivableRows.length" class="m-0 text-[12px] text-ink-3">
          {{ activityRows.length - archivableRows.length }} running {{ activityRows.length - archivableRows.length === 1 ? 'item' : 'items' }} will be skipped.
        </p>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="h-7 rounded-[5px] border border-rule-light px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
            @click="archiveAllDialogOpen = false"
          >
            Cancel
          </button>
          <button
            type="button"
            class="h-7 rounded-[5px] bg-accent px-3 text-[12px] font-medium text-accent-ink hover:opacity-90"
            data-testid="archive-all-confirm"
            @click="confirmArchiveAll"
          >
            Archive all
          </button>
        </div>
      </div>
    </MimDialog>

    <!-- Resize handle (expanded tray only; the rail is fixed width) -->
    <div
      v-if="!collapsed"
      class="group/sb-resize absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize"
      @pointerdown="$emit('resize', $event)"
    >
      <span
        class="absolute left-[3px] top-0 h-full w-[2px] rounded-[1px] bg-transparent transition-colors duration-150 group-hover/sb-resize:bg-accent"
        :class="draggingActive ? 'bg-accent' : ''"
        aria-hidden="true"
      />
    </div>
  </aside>
</template>

<style scoped>
/* Drag region — vendor-prefixed, cannot be expressed in Tailwind */
.sb-drag-handle {
  -webkit-app-region: drag;
}
</style>
