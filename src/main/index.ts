import { app, BrowserWindow, ipcMain, shell, dialog, nativeImage } from 'electron'
import { basename, join, dirname, extname, relative, isAbsolute, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { ApprovalMode, PermissionApprovalDecision } from '@main/security/gate.js'
import { cloneRepo } from '@main/git.js'
import { closeGuardDecision } from '@main/closeGuard.js'
import { installApplicationMenu } from '@main/menu.js'
import { initAutoUpdater, shouldInitializeAutoUpdater } from '@main/autoUpdater.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { createServer } from '@main/server/server.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { createTraceOutcomeTracker } from '@main/trace/outcomes.js'
import { resolveTelemetryConfig } from '@main/telemetry/config.js'
import { readTelemetryIdentity, setTelemetryIdentityEnabled } from '@main/telemetry/identity.js'
import { createTelemetry } from '@main/telemetry/telemetry.js'
import { loadUserConfig } from '@main/userConfig.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import { createPackageRuntime } from '@main/packages/packageRuntime.js'
import { createPackageJobRunner } from '@main/packages/packageJobs.js'
import { registerFileTools } from '@main/tools/fs.js'
import { registerCommentTools } from '@main/tools/comments.js'
import { registerWorkspaceTools } from '@main/tools/workspace.js'
import { registerPackageTools } from '@main/tools/packages.js'
import { registerPackageRuntimeTools } from '@main/tools/packageRuntime.js'
import { registerRegistryTools } from '@main/tools/registryTools.js'
import { lookupRegistryEntry, setAccountRegistryDev } from '@main/packages/registrySources.js'
import { registerInstallTools } from '@main/tools/install.js'
import { DEFAULT_CACHE_ROOT } from '@main/packages/cacheLayout.js'
import { registerBridgeTools } from '@main/tools/bridge.js'
import { readTraceCaptureContent, readTraceRetentionDays, registerSettingsTools } from '@main/tools/settings.js'
import { registerToolPolicyTools } from '@main/tools/toolPolicy.js'
import { registerToolchainTools } from '@main/tools/toolchain.js'
import { registerCodeTools } from '@main/tools/code.js'
import { registerSessionTools } from '@main/sessions.js'
import { registerArchiveTools } from '@main/tools/archive.js'
import { registerAiTools } from '@main/ai/ai.js'
import { registerPtyTools, spawnPtyProcess, writePty } from '@main/pty.js'
import { createAgentSessions } from '@main/agents/agentSessions.js'
import { registerAgentTools } from '@main/tools/agents.js'
import { registerSearchTools } from '@main/tools/search.js'
import { registerGitTools } from '@main/tools/git.js'
import { registerSyncTools } from '@main/tools/sync.js'
import { registerTraceTools } from '@main/tools/trace.js'
import { createHistoryStore, type HistoryStore } from '@main/history/history.js'
import { registerHistoryTools } from '@main/tools/history.js'
import { registerDocumentTools } from '@main/tools/documents.js'
import { registerRenderTools } from '@main/tools/render.js'
import { registerExportTools } from '@main/tools/export.js'
import { registerReferencesTools } from '@main/tools/references.js'
import { renderDocumentHtmlToPdf, renderHtmlFileToPdf } from '@main/htmlPdf.js'
import { registerSkillTools } from '@main/tools/skills.js'
import { createNamedPackageToolSync, type NamedPackageToolSync } from '@main/packages/namedPackageTools.js'
import { createAgentContextContributionsProvider, createLocalPackageStatusProvider } from '@main/packages/packageContributions.js'
import { registerCoreAppTools } from '@main/tools/coreApps.js'
import { checkForUpdates } from '@main/packages/updateCheck.js'
import { registerLogbookTools } from '@main/tools/logbook.js'
import { registerWebTools } from '@main/tools/web.js'
import { createElectronLiveBrowserDriver } from '@main/web/liveBrowser.js'
import { renderUrlInHiddenWindow } from '@main/web/renderedBrowser.js'
import {
  clearBrowserSessionProfile,
  openBrowserSessionWindow,
  renderUrlInBrowserSession,
} from '@main/web/browserSession.js'
import {
  addBrowserSessionDomain,
  isBrowserSessionAllowed,
  readBrowserSessionSettings,
} from '@main/web/browserSessionSettings.js'
import { parseAllowedHttpUrl } from '@main/web/urlPolicy.js'
import { registerAccountTools, readAccountToken, setAccountDev } from '@main/tools/account.js'
import { registerSlackTools } from '@main/integrations/slack/tools.js'
import { registerGoogleTools } from '@main/integrations/google/tools.js'
import { SLACK_MCP_TOOL_SPECS, GOOGLE_MCP_TOOL_SPECS } from '@main/server/server.js'
import { registerTelemetryTools } from '@main/tools/telemetry.js'
import { createKeytarSecretStore } from '@main/integrations/secrets.js'
import { registerResourceTools } from '@main/tools/resources.js'
import { resolveCollections, readResourceBindings, syncMounts } from '@main/resources/resourceModel.js'
import { parseMimYaml, readCommittedApp, classifyWorkspace, scaffoldWorkspace } from '@main/workspace/workspaceContract.js'
import { setAgentContextResourceReader, setAgentContextAppsResolver, setAgentContextContributionsProvider, setAgentContextLocalPackagesProvider, type AgentContextResource, type AgentContextApp } from '@main/ai/agentContext.js'
import { resolveBootWorkspace, recordLastWorkspace, isDefaultWorkspace } from '@main/workspace/workspaceBoot.js'
import { deleteMcpDiscoveryFile, writeMcpDiscoveryFile } from '@main/mcp/discovery.js'
import { createWorkspaceFileWatcher } from '@main/workspace/workspaceFileWatcher.js'
import { toSlashPath, userHomeDir } from '@main/platform.js'

const HOME_DIR = userHomeDir()
const AUTO_HISTORY_BASELINE_DELAY_MS = 2_000
const AUTO_HISTORY_BASELINE_OPTIONS = {
  maxScanned: 1_000,
  maxCaptured: 200,
  maxDurationMs: 750,
} as const
import { readAttachmentPaths } from '@main/attachments.js'
import { initSearchDb, closeSearchDb, rebuildIndex } from '@main/search/search.js'
import { getSystemPrompt } from '@main/ai/systemPrompt.js'
import { createPermissionGate, traceGateDecision } from '@main/security/gate.js'
import type { ToolRegistry } from '@main/tools/registry.js'

let mainWindow: BrowserWindow | null = null
let recentFiles: string[] = []
let workspaceFileWatcher: ReturnType<typeof createWorkspaceFileWatcher> | null = null
let telemetryShutdown: (() => Promise<void>) | null = null
let appUpdateInitialTimer: ReturnType<typeof setTimeout> | null = null
let appUpdateInterval: ReturnType<typeof setInterval> | null = null
let historyBaselineTimer: ReturnType<typeof setTimeout> | null = null

export const OPEN_DIRECTORY_DIALOG_PROPERTIES = ['openDirectory', 'createDirectory'] as const

export function configureLinuxCommandLine(
  commandLine: { appendSwitch(name: string, value?: string): void },
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'linux') return
  commandLine.appendSwitch('enable-features', 'UseOzonePlatform')
  commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

export function mainWindowChromeOptions(platform: NodeJS.Platform = process.platform) {
  if (platform !== 'darwin') return {}
  return {
    titleBarStyle: 'hiddenInset' as const,
    // Lights at x=14 on a 20px pitch (zoom ends at x=66) sit on the collapsed
    // Navigator's chrome slab; the bridged pane header places the
    // expand-sidebar button on the next slot of that grid (x=74) via
    // NAVIGATOR_HEADER_BRIDGE_INSET.
    trafficLightPosition: { x: 14, y: 14 },
  }
}

function scheduleAutoHistoryBaseline(history: HistoryStore): void {
  if (historyBaselineTimer != null) clearTimeout(historyBaselineTimer)
  historyBaselineTimer = setTimeout(() => {
    historyBaselineTimer = null
    try { history.baselineWorkspace(AUTO_HISTORY_BASELINE_OPTIONS) } catch { /* local history baseline is best-effort */ }
  }, AUTO_HISTORY_BASELINE_DELAY_MS)
}

export function createMainWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    ...mainWindowChromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    }
  })
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function rebuildApplicationMenu(): void {
  installApplicationMenu({
    platform: process.platform,
    appName: app.name,
    recentFiles,
    callbacks: {
      onNewDocument: () => sendToRenderer('menu:new-document'),
      onOpenFile: () => sendToRenderer('menu:open-file'),
      onSaveFile: () => sendToRenderer('menu:save-file'),
      onSaveFileAs: () => sendToRenderer('menu:save-file-as'),
      onExportDocument: () => sendToRenderer('menu:export-document'),
      onOpenRecent: (path) => sendToRenderer('menu:open-recent', path),
      onClearRecent: () => sendToRenderer('menu:clear-recent'),
      onCloseTab: () => sendToRenderer('menu:close-tab'),
      onOpenSettings: () => sendToRenderer('menu:settings'),
      onShowShortcuts: () => sendToRenderer('menu:shortcuts'),
      onShowWelcome: () => sendToRenderer('menu:welcome'),
    },
  })
}

function scheduleAppUpdateChecks(updater: ReturnType<typeof initAutoUpdater>): void {
  clearAppUpdateTimers()

  const runCheck = () => {
    void updater.checkForUpdates().catch(() => {})
  }

  appUpdateInitialTimer = setTimeout(runCheck, 30_000)
  appUpdateInitialTimer.unref?.()
  appUpdateInterval = setInterval(runCheck, 4 * 60 * 60 * 1000)
  appUpdateInterval.unref?.()
}

function clearAppUpdateTimers(): void {
  if (appUpdateInitialTimer != null) {
    clearTimeout(appUpdateInitialTimer)
    appUpdateInitialTimer = null
  }
  if (appUpdateInterval != null) {
    clearInterval(appUpdateInterval)
    appUpdateInterval = null
  }
}

function toWorkspaceRelative(workspace: string | null, absPath: string): string {
  if (!workspace) return absPath
  const rel = relative(workspace, absPath)
  if (rel.startsWith('..') || isAbsolute(rel)) return absPath
  return toSlashPath(rel)
}

function requireWorkspaceRelative(workspace: string | null, absPath: string): string {
  if (!workspace) throw new Error('No workspace open')
  const rel = relative(workspace, absPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Files must be saved inside the current workspace.')
  }
  return rel.replace(/\\/g, '/')
}

function resolveUserVisiblePath(workspace: string | null, path: string): string {
  if (isAbsolute(path) || !workspace) return path
  const resolved = resolve(workspace, path)
  const rel = relative(workspace, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path traversal outside workspace is not allowed')
  return resolved
}

function resolveSaveDialogDefaultPath(workspace: string, defaultPath: unknown): string {
  if (typeof defaultPath !== 'string' || defaultPath.trim().length === 0) {
    return join(workspace, 'Untitled.md')
  }
  const resolved = resolve(workspace, defaultPath)
  const rel = relative(workspace, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) return join(workspace, basename(defaultPath))
  return resolved
}

function uniqueDestination(dir: string, filename: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  let candidate = join(dir, filename)
  let index = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}-${index}${ext}`)
    index++
  }
  return candidate
}

function extnameLower(path: string): string {
  return extname(path).toLowerCase().replace(/^\./, '')
}

async function boot(): Promise<void> {
  let tools!: ToolRegistry
  const appVersion = app.getVersion()
  const telemetryConfig = resolveTelemetryConfig({ home: HOME_DIR })
  let telemetryIdentity = telemetryConfig.disabled
    ? null
    : readTelemetryIdentity({ home: HOME_DIR })
  const telemetry = createTelemetry({
    appVersion,
    platform: telemetryConfig.platform,
    runtime: 'electron',
    anonId: telemetryIdentity?.anonId ?? 'disabled',
    enabled: (telemetryIdentity?.enabled ?? false) && !telemetryConfig.disabled,
    locked: telemetryConfig.locked,
    endpoint: telemetryConfig.endpoint,
    onEnabledChange: (enabled) => {
      telemetryIdentity = setTelemetryIdentityEnabled(enabled, { home: HOME_DIR })
    },
  })
  telemetryShutdown = () => telemetry.shutdown()
  // Principal is the human identity behind every actor in the trace stream.
  // Single-user today (from ~/.mim/config.yaml), but stamped per event because
  // identity cannot be retrofitted once multi-user/hosted deployments exist.
  const traceLog = createTraceLog({
    sinks: [telemetry.createTelemetrySink()],
    getPrincipal: () => {
      const user = loadUserConfig().user
      return user.email ?? user.name
    },
    getRetentionDays: () => readTraceRetentionDays(tools?.getWorkspacePath() ?? null),
  })
  let server: Awaited<ReturnType<typeof createServer>> | null = null
  let packages: Awaited<ReturnType<typeof createPackageLoader>> | null = null
  let namedPackageTools: NamedPackageToolSync | null = null
  let packageEnablement: ReturnType<typeof createPackageEnablementStore> | null = null
  let appUpdater: ReturnType<typeof initAutoUpdater> | null = null
  let lastDirtyTabCount = 0
  let dirtyOpenFilePaths = new Set<string>()

  // Git mirrors live in a single per-machine cache shared across workspaces, so
  // a repo is cloned once no matter how many workspaces mount it.
  const resourcesMirrorsDir = join(app.getPath('userData'), 'resources')

  function resolveWorkspaceCollections(ws: string) {
    const mimYamlPath = join(ws, 'mim.yaml')
    const config = existsSync(mimYamlPath)
      ? parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
      : { name: '' }
    return resolveCollections({
      workspaceDir: ws,
      config,
      bindings: readResourceBindings(ws),
      mirrorsDir: resourcesMirrorsDir,
    })
  }

  // Reconcile .mim/resources/* symlinks with the resolved collections. Best
  // effort: a sync failure must never block opening a workspace.
  function syncWorkspaceMounts(ws: string): void {
    try {
      syncMounts(ws, resolveWorkspaceCollections(ws))
    } catch {
      /* mount sync is non-fatal */
    }
  }

  // Feeds the agent-context.md "Shared resources" section (see agentContext.ts).
  setAgentContextResourceReader((ws): AgentContextResource[] =>
    resolveWorkspaceCollections(ws).map((c) => ({
      id: c.id,
      name: c.name,
      mountPath: c.mountPath.startsWith(ws)
        ? toSlashPath(c.mountPath.slice(ws.length + 1))
        : c.mountPath,
      write: c.write,
      status: c.status,
    })),
  )

  const gate = createPermissionGate({
    getApprovalMode: () => readApprovalMode(tools),
    getWorkspacePath: () => tools.getWorkspacePath(),
    getPackagePermissions: (packageId) => packages?.get(packageId)?.manifest.permissions,
    getDynamicToolPolicy: (name) => namedPackageTools?.getPolicy(name),
    resolveSavedBrowserSessionGrant: (toolName, params) => {
      if ((toolName !== 'web.read' && toolName !== 'web.live.open') || params.stateful !== true || typeof params.url !== 'string') return null
      const ws = tools.getWorkspacePath()
      if (!ws) return null
      try {
        const parsed = parseAllowedHttpUrl(params.url)
        const settings = readBrowserSessionSettings(ws)
        const match = isBrowserSessionAllowed(parsed.href, settings.allowedDomains)
        return { domain: match.host, granted: settings.enabled && match.allowed }
      } catch {
        return null
      }
    },
    grantSavedBrowserSessionDomain: (grant) => {
      const ws = tools.getWorkspacePath()
      if (!ws) throw new Error('No workspace open')
      addBrowserSessionDomain(ws, grant.domain)
    },
    // The gate hard-denies writes to readonly/unknown collections for every
    // actor; this resolver supplies the effective per-collection policy.
    getResourceWritePolicy: (id) => {
      const ws = tools.getWorkspacePath()
      if (!ws) return null
      return resolveWorkspaceCollections(ws).find((c) => c.id === id)?.write ?? null
    },
    sendApprovalRequest: (request) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false
      mainWindow.webContents.send('gate:request', request)
      return true
    },
    recordDecision: (event) => traceGateDecision(traceLog, event),
  })
  const traceOutcomes = createTraceOutcomeTracker({
    trace: traceLog,
    getWorkspacePath: () => tools?.getWorkspacePath() ?? null,
  })
  const history = createHistoryStore({
    getWorkspacePath: () => tools?.getWorkspacePath() ?? null,
  })
  tools = createToolRegistry(traceLog, gate, {
    outcomes: traceOutcomes,
    history: history.toolObserver(),
    getCaptureContent: () => readTraceCaptureContent(tools?.getWorkspacePath() ?? null),
  })
  workspaceFileWatcher = createWorkspaceFileWatcher({
    emit: (channel, payload) => {
      mainWindow?.webContents.send(channel, payload)
      for (const change of payload.changes) {
        traceOutcomes.observeFileChange(change)
        history.observeFileChange(change)
      }
    },
  })

  registerFileTools(tools, {
    openNativeFile: (path) => shell.openPath(path),
    trashItem: (path) => shell.trashItem(path),
  })
  registerCommentTools(tools, {
    isDirtyOpenPath: (path) => dirtyOpenFilePaths.has(path),
  })
  registerWorkspaceTools(tools)
  registerBridgeTools(tools)
  registerSettingsTools(tools)
  registerToolPolicyTools(tools)
  registerToolchainTools(tools)
  registerCodeTools(tools)
  // Registered here (not a tools/ module) because it needs the Electron app
  // handle; the headless server never has these versions to report.
  tools.register({
    name: 'app.info',
    description: 'App version and runtime info for the About panel and diagnostics',
    execute: async () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    }),
  })
  registerSessionTools(tools)
  registerAiTools(tools, (channel) => {
    mainWindow?.webContents.send(channel)
    server?.broadcast(channel, {})
  })
  registerPtyTools(tools)
  registerSearchTools(tools)
  registerGitTools(tools)
  registerSyncTools(tools)
  registerTraceTools(tools)
  registerHistoryTools(tools, history)
  registerDocumentTools(tools)
  registerRenderTools(tools, { render: renderHtmlFileToPdf })
  registerExportTools(tools, { renderPdf: renderDocumentHtmlToPdf })
  registerReferencesTools(tools)
  registerSkillTools(tools, {
    getPackageSkillRoots: () =>
      (packages?.list() ?? [])
        .filter(p => packageEnablement?.isEnabled(p))
        .map(p => ({
          packageId: p.manifest.id,
          packageName: p.manifest.name,
          dir: join(p.dir, 'skills'),
        }))
        .filter(p => existsSync(p.dir)),
    emit: (channel) => {
      mainWindow?.webContents.send(channel)
      server?.broadcast(channel, {})
    },
  })
  registerLogbookTools(tools)
  registerWebTools(tools, {
    renderRenderedPage: renderUrlInHiddenWindow,
    renderSavedBrowserSessionPage: renderUrlInBrowserSession,
    openSavedBrowserSession: openBrowserSessionWindow,
    clearSavedBrowserSessionProfile: clearBrowserSessionProfile,
    liveBrowser: createElectronLiveBrowserDriver({
      getWorkspacePath: () => tools.getWorkspacePath(),
    }),
  })
  const slackMcp = registerSlackTools(tools)
  const googleMcp = registerGoogleTools(tools, {
    openExternal: (url) => shell.openExternal(url),
  })
  void slackMcp.refresh()
  void googleMcp.refresh()
  registerTelemetryTools(tools, telemetry)
  setAccountDev(is.dev)
  setAccountRegistryDev(is.dev)
  registerAccountTools(tools, (channel) => {
    mainWindow?.webContents.send(channel)
    server?.broadcast(channel, {})
  })
  telemetry.track('app_open', {
    appVersion,
    platform: telemetryConfig.platform,
    runtime: 'electron',
  })
  registerResourceTools(tools, {
    mirrorsDir: resourcesMirrorsDir,
    emit: (channel) => {
      mainWindow?.webContents.send(channel)
      server?.broadcast(channel, {})
    },
  })
  tools.register({
    name: 'documents.pickReviewFile',
    description: 'Open a native picker for a DOCX review document and return a workspace-relative path. External files are copied into inputs/.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        defaultPath: workspace,
        filters: [{ name: 'Word documents', extensions: ['docx'] }],
      })
      if (result.canceled || !result.filePaths[0]) return { cancelled: true }
      const selected = result.filePaths[0]
      const rel = relative(workspace, selected)
      if (!rel.startsWith('..') && !isAbsolute(rel)) {
        return {
          cancelled: false,
          path: rel.replace(/\\/g, '/'),
          filename: basename(selected),
          size: statSync(selected).size,
          copied: false,
        }
      }

      const inputsDir = join(workspace, 'inputs')
      mkdirSync(inputsDir, { recursive: true })
      const destination = uniqueDestination(inputsDir, basename(selected))
      copyFileSync(selected, destination)
      return {
        cancelled: false,
        path: toSlashPath(relative(workspace, destination)),
        filename: basename(selected),
        size: statSync(destination).size,
        copied: true,
      }
    },
  })
  tools.register({
    name: 'documents.pickImportFile',
    description: 'Open a native picker for an importable document and return a workspace-relative path. External files are copied into inputs/.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        defaultPath: workspace,
        filters: [
          { name: 'Importable documents', extensions: ['docx', 'xlsx', 'xlsm', 'pdf', 'bib'] },
          { name: 'Word documents', extensions: ['docx'] },
          { name: 'Excel workbooks', extensions: ['xlsx', 'xlsm'] },
          { name: 'PDF documents', extensions: ['pdf'] },
          { name: 'BibTeX libraries', extensions: ['bib'] },
        ],
      })
      if (result.canceled || !result.filePaths[0]) return { cancelled: true }
      const selected = result.filePaths[0]
      const rel = relative(workspace, selected)
      if (!rel.startsWith('..') && !isAbsolute(rel)) {
        return {
          cancelled: false,
          path: toSlashPath(rel),
          filename: basename(selected),
          extension: extnameLower(selected),
          size: statSync(selected).size,
          copied: false,
        }
      }

      const inputsDir = join(workspace, 'inputs')
      mkdirSync(inputsDir, { recursive: true })
      const destination = uniqueDestination(inputsDir, basename(selected))
      copyFileSync(selected, destination)
      return {
        cancelled: false,
        path: toSlashPath(relative(workspace, destination)),
        filename: basename(selected),
        extension: extnameLower(selected),
        size: statSync(destination).size,
        copied: true,
      }
    },
  })

  // Restore the last-opened workspace (or create+open a default). This always
  // yields a real, existing workspace path so sessions load on every launch.
  const bootWorkspace = resolveBootWorkspace(HOME_DIR)
  await tools.call('workspace.open', { path: bootWorkspace }, { actor: 'system' })
  telemetry.track('workspace_open')

  // Auto-initialize the default workspace the app itself created, so the
  // InitWorkspaceBanner never nags about a folder Mim made. User-opened
  // external folders still get the banner with its plain-language guidance.
  if (isDefaultWorkspace(HOME_DIR, bootWorkspace)) {
    try {
      const status = classifyWorkspace(bootWorkspace)
      if (!status.initialized) {
        scaffoldWorkspace(bootWorkspace, { name: basename(bootWorkspace) })
      }
    } catch { /* auto-init non-fatal — the banner remains as fallback */ }
  }

  await workspaceFileWatcher.setWorkspace(bootWorkspace)
  scheduleAutoHistoryBaseline(history)
  syncWorkspaceMounts(bootWorkspace)
  recordLastWorkspace(HOME_DIR, bootWorkspace)
  try { initSearchDb(bootWorkspace) } catch { /* search db init non-fatal */ }
  // Defer FTS reindex so the window paints before scanning session files.
  setImmediate(() => { try { rebuildIndex(bootWorkspace) } catch { /* search index non-fatal */ } })

  packages = await createPackageLoader(tools)
  packageEnablement = createPackageEnablementStore({
    getWorkspacePath: () => tools.getWorkspacePath(),
  })
  const packageSecretStore = createKeytarSecretStore()
  const packageRuntime = createPackageRuntime({
    packages,
    enablement: packageEnablement,
    tools,
    trace: traceLog,
    secrets: packageSecretStore,
  })
  namedPackageTools = createNamedPackageToolSync({ runtime: packageRuntime, tools, packages })
  setAgentContextContributionsProvider(createAgentContextContributionsProvider({ runtime: packageRuntime, packages }))
  setAgentContextLocalPackagesProvider(createLocalPackageStatusProvider({ runtime: packageRuntime, packages, enablement: packageEnablement }))
  const packageJobs = createPackageJobRunner({
    runtime: packageRuntime,
    trace: traceLog,
    getWorkspacePath: () => tools.getWorkspacePath(),
    emit: (event, data) => {
      server?.broadcast(event, data)
      mainWindow?.webContents.send(event, data)
    },
  })
  packageJobs.reconcileStaleRuns()
  registerPackageTools(tools, packages, packageEnablement, {
    invalidate: (id) => packageRuntime.invalidate(id),
    syncNamedTools: async () => { await namedPackageTools?.sync() },
    emit: (channel, payload) => {
      mainWindow?.webContents.send(channel, payload)
      server?.broadcast(channel, payload ?? {})
    },
  })
  const cacheRoot = DEFAULT_CACHE_ROOT
  const installGlobalDir = join(HOME_DIR, '.mim', 'packages')
  registerRegistryTools(tools, {
    packages,
    enablement: packageEnablement,
    cacheRoot,
    globalDir: installGlobalDir,
    getWorkspacePath: () => tools.getWorkspacePath(),
    getAccountToken: () => readAccountToken(),
  })
  registerInstallTools(tools, {
    packages,
    enablement: packageEnablement,
    cacheRoot,
    globalDir: installGlobalDir,
    clock: () => Date.now(),
    lookupRegistryEntry: (id, version) => lookupRegistryEntry(id, {
      workspacePath: tools.getWorkspacePath(),
      cacheRoot,
      version,
      isSourceTrusted: (s) => packageEnablement.isRegistryTrusted(s),
    }, { getAccountToken: () => readAccountToken() }),
  })
  registerCoreAppTools(tools, {
    packages,
    enablement: packageEnablement,
    invalidate: (id) => { packageRuntime.invalidate(id); void namedPackageTools?.sync() },
    emit: (channel) => {
      mainWindow?.webContents.send(channel)
      server?.broadcast(channel, {})
    },
  })

  setAgentContextAppsResolver((ws): AgentContextApp[] => {
    const apps = new Map<string, AgentContextApp>()
    for (const pkg of packages.list()) {
      apps.set(pkg.manifest.id, {
        id: pkg.manifest.id,
        enabled: packageEnablement.isEnabled(pkg),
      })
    }
    const mimYamlPath = join(ws, 'mim.yaml')
    if (existsSync(mimYamlPath)) {
      try {
        const config = parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
        for (const id of Object.keys(config.apps ?? {})) {
          if (apps.has(id)) continue
          const committed = readCommittedApp(ws, id)
          if (committed) apps.set(id, { id, enabled: false })
        }
      } catch { /* best-effort */ }
    }
    return [...apps.values()].sort((a, b) => a.id.localeCompare(b.id))
  })

  registerPackageRuntimeTools(tools, packages, packageRuntime, packageJobs, {
    secretStore: packageSecretStore,
  })
  await namedPackageTools.sync()
  registerArchiveTools(tools, packageJobs)

  const agentSessions = createAgentSessions({
    getWorkspacePath: () => tools.getWorkspacePath(),
    spawnPty: spawnPtyProcess,
    getMcpServerPort: () => {
      if (!server) throw new Error('MCP server is not initialized')
      return server.port
    },
    createMcpToken: (sessionId) => {
      if (!server) throw new Error('MCP server is not initialized')
      return server.createMcpToken(sessionId)
    },
    revokeMcpToken: (token) => {
      server?.revokeMcpToken(token)
    },
    emit: (event, data) => {
      server?.broadcast(event, data)
      mainWindow?.webContents.send(event, data)
    },
    generateTitle: (scrollbackText) => {
      if (!server) return Promise.resolve(null)
      return server.generateTaskLabel(scrollbackText)
    },
  })
  agentSessions.reconcileStaleSessions()
  registerAgentTools(tools, { sessions: agentSessions })

  tools.register({
    name: 'system.prompt',
    description: 'Get the system prompt for the AI chat',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ prompt: getSystemPrompt(tools.getWorkspacePath() ?? undefined) })
  })

  server = await createServer(tools, packages, {
    getNamedMcpTools: () => {
      const specs: Array<{ name: string; mimName: string; description: string }> = []
      if (namedPackageTools) {
        for (const name of namedPackageTools.ownedNames()) {
          const tool = tools.get(name)
          if (tool) specs.push({ name: name.replace(/\./g, '_'), mimName: name, description: tool.description })
        }
      }
      if (slackMcp.connected) specs.push(...SLACK_MCP_TOOL_SPECS)
      if (googleMcp.connected) specs.push(...GOOGLE_MCP_TOOL_SPECS)
      return specs
    },
  })
  try {
    writeMcpDiscoveryFile({
      port: server.port,
      token: server.createMcpToken('mcp'),
    }, HOME_DIR)
  } catch (err) {
    console.error('[mcp] Failed to write discovery file', err)
  }

  // Fire-and-forget update check, broadcast to renderer + WebSocket so the
  // Apps surface can show update badges. Swallows errors silently — offline
  // and missing mirrors are normal. Runs at boot and on workspace switch.
  function refreshAppUpdates(workspacePath: string | null): void {
    void checkForUpdates({
      workspacePath,
      cacheRoot,
      globalDir: installGlobalDir,
      isSourceTrusted: (s) => packageEnablement.isRegistryTrusted(s),
      getAccountToken: () => readAccountToken(),
    }).then((result) => {
      mainWindow?.webContents.send('apps:updates', result)
      server?.broadcast('apps:updates', result)
    }).catch(() => { /* offline is normal */ })
  }
  refreshAppUpdates(tools.getWorkspacePath())

  async function openWorkspacePath(path: string): Promise<string> {
    await tools.call('workspace.open', { path }, { actor: 'user' })
    telemetry.track('workspace_open')
    await workspaceFileWatcher?.setWorkspace(path)
    scheduleAutoHistoryBaseline(history)
    syncWorkspaceMounts(path)
    recordLastWorkspace(HOME_DIR, path)
    try { closeSearchDb(); initSearchDb(path) } catch { /* search db init non-fatal */ }
    // Defer FTS reindex so workspace switch feels instant.
    setImmediate(() => { try { rebuildIndex(path) } catch { /* search index non-fatal */ } })
    await packages!.rescan()
    packageRuntime.invalidate()
    await namedPackageTools!.sync()
    mainWindow?.webContents.send('packages:changed', packages!.list())
    mainWindow?.webContents.send('workspace:changed', path)
    mainWindow?.webContents.send('resources:changed')
    // Notify package iframes via WebSocket so they reload their data
    server?.broadcast('workspace:changed', { path })
    server?.broadcast('resources:changed', {})
    refreshAppUpdates(path)
    return path
  }

  ipcMain.handle('kernel:open-workspace', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: [...OPEN_DIRECTORY_DIALOG_PROPERTIES]
    })
    if (!result.canceled && result.filePaths[0]) {
      return openWorkspacePath(result.filePaths[0])
    }
    return null
  })

  ipcMain.handle('kernel:open-workspace-path', async (_event, path: string) => {
    if (typeof path !== 'string' || path.length === 0) return null
    return openWorkspacePath(path)
  })

  ipcMain.handle('kernel:watch-workspace-file', async (_event, path: string) => ({
    watching: typeof path === 'string' ? workspaceFileWatcher?.watchFile(path) === true : false,
  }))

  ipcMain.handle('kernel:unwatch-workspace-file', async (_event, path: string) => ({
    unwatched: typeof path === 'string' ? await workspaceFileWatcher?.unwatchFile(path) === true : false,
  }))

  ipcMain.handle('kernel:open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: [...OPEN_DIRECTORY_DIALOG_PROPERTIES]
    })
    if (!result.canceled && result.filePaths[0]) {
      return result.filePaths[0]
    }
    return null
  })

  // Open a single file for the editor. Returns a workspace-relative path when the
  // selection lives inside the workspace (so fs.read and tab de-duplication stay
  // consistent with the rest of the app), otherwise the absolute path.
  ipcMain.handle('kernel:open-file-dialog', async () => {
    const workspace = tools.getWorkspacePath()
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      defaultPath: workspace ?? undefined,
    })
    if (result.canceled || !result.filePaths[0]) return null
    return toWorkspaceRelative(workspace, result.filePaths[0])
  })

  ipcMain.handle('kernel:save-file-dialog', async (
    _event,
    options: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }>; allowAbsolutePath?: boolean } = {},
  ) => {
    const workspace = tools.getWorkspacePath()
    if (!workspace) throw new Error('No workspace open')
    const filters = Array.isArray(options.filters) && options.filters.length > 0
      ? options.filters.filter(f => f && typeof f.name === 'string' && Array.isArray(f.extensions))
      : [
          { name: 'Text and Markdown', extensions: ['md', 'markdown', 'txt'] },
          { name: 'All Files', extensions: ['*'] },
        ]
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: resolveSaveDialogDefaultPath(workspace, options.defaultPath),
      filters,
    })
    if (result.canceled || !result.filePath) return null
    if (options.allowAbsolutePath) return result.filePath
    return requireWorkspaceRelative(workspace, result.filePath)
  })

  // The renderer owns the canonical recent-files list (persisted per workspace);
  // it pushes updates here so the native "Open Recent" menu stays in sync.
  ipcMain.handle('kernel:set-recent-files', async (_event, files: unknown) => {
    recentFiles = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : []
    rebuildApplicationMenu()
    return { ok: true }
  })

  ipcMain.handle('kernel:pick-attachments', async (_event, options: { kind?: string } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: options.kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        : undefined,
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { attachments: [] }
    }
    return { attachments: readAttachmentPaths(result.filePaths, { workspacePath: tools.getWorkspacePath() }) }
  })

  ipcMain.handle('kernel:read-attachments', async (_event, paths: string[]) => {
    return {
      attachments: readAttachmentPaths(
        paths.filter(path => typeof path === 'string' && path.length > 0),
        { workspacePath: tools.getWorkspacePath() },
      ),
    }
  })

  ipcMain.handle('kernel:create-directory', async (_event, dirPath: string) => {
    if (existsSync(dirPath)) {
      throw new Error('A folder already exists at this location.')
    }
    mkdirSync(dirPath, { recursive: true })
    return { created: dirPath }
  })

  ipcMain.handle('kernel:git-clone', async (_event, url: string, target: string, token?: string) => {
    return cloneRepo(url, target, token)
  })

  ipcMain.handle('kernel:open-native-file', async (_event, path: string) => {
    if (typeof path !== 'string' || path.length === 0) throw new Error('Path is required')
    const resolved = resolveUserVisiblePath(tools.getWorkspacePath(), path)
    const stat = statSync(resolved)
    if (!stat.isFile()) throw new Error(`Not a file: ${path}`)
    const error = await shell.openPath(resolved)
    if (error) throw new Error(error)
    return { opened: path }
  })

  ipcMain.handle('kernel:reveal-in-finder', async (_event, dirPath: string) => {
    shell.showItemInFolder(resolveUserVisiblePath(tools.getWorkspacePath(), dirPath))
  })

  // Universal tool dispatch — renderer calls kernel.call() via IPC.
  // The renderer is always 'user': only main-process internals (AI runtime,
  // package runtime) may set actor to 'ai' or 'package'. Accepting those
  // from IPC would let XSS in the renderer bypass the approval gate.
  ipcMain.handle('kernel:call', async (
    _event,
    tool: string,
    params: Record<string, unknown> = {},
    options: { sessionId?: string } = {},
  ) => {
    return tools.call(tool, params, {
      actor: 'user',
      sessionId: typeof options.sessionId === 'string' ? options.sessionId : undefined,
    })
  })
  ipcMain.handle('gate:respond', async (
    _event,
    requestId: string,
    decision: PermissionApprovalDecision,
  ) => gate.respond(requestId, decision))
  ipcMain.handle('gate:cancel-session', async (
    _event,
    sessionId: string,
  ) => gate.cancelSession(sessionId))

  // Fast-path pty input — renderer keystrokes bypass the tool registry.
  ipcMain.on('pty:input', (_event, id: number, data: string) => writePty(id, data))

  ipcMain.handle('kernel:port', () => server!.port)
  ipcMain.handle('kernel:packages', () => packages.list())
  ipcMain.handle('kernel:workspace', () => tools.getWorkspacePath())
  ipcMain.handle('kernel:package-launch-url', (_event, packageId: string, viewId?: string) =>
    server!.createPackageLaunchUrl(packageId, viewId),
  )
  ipcMain.handle('kernel:download-update', async () => {
    if (!appUpdater) throw new Error('App updates are unavailable in this build')
    await appUpdater.downloadUpdate()
  })
  ipcMain.handle('kernel:quit-and-install', async () => {
    if (!appUpdater) throw new Error('App updates are unavailable in this build')
    appUpdater.quitAndInstall()
  })

  packages.onChange(() => {
    packageRuntime.invalidate()
    void namedPackageTools!.sync()
    mainWindow?.webContents.send('packages:changed', packages.list())
  })

  mainWindow = createMainWindow()

  if (shouldInitializeAutoUpdater({
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImage: process.env.APPIMAGE,
  })) {
    appUpdater = initAutoUpdater({
      send: (channel, data) => {
        mainWindow?.webContents.send(channel, data)
      },
      broadcast: (channel, data) => {
        server?.broadcast(channel, data)
      },
    })
    scheduleAppUpdateChecks(appUpdater)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // ── Dirty-tab quit guard ──
  // The renderer pushes its dirty-tab count whenever the set changes.
  // On window close, main reads the last-known value and prompts if > 0.
  ipcMain.handle('editor:dirty-state', (_event, state: number | { count?: number; paths?: string[] }) => {
    if (typeof state === 'number') {
      lastDirtyTabCount = state >= 0 ? state : 0
      dirtyOpenFilePaths = new Set()
      return
    }
    if (!state || typeof state !== 'object') {
      lastDirtyTabCount = 0
      dirtyOpenFilePaths = new Set()
      return
    }
    lastDirtyTabCount = typeof state.count === 'number' && state.count >= 0 ? state.count : 0
    dirtyOpenFilePaths = new Set(
      Array.isArray(state.paths)
        ? state.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
        : [],
    )
  })

  mainWindow.on('close', (e) => {
    const decision = closeGuardDecision(lastDirtyTabCount, packageJobs.activeRunCount(), agentSessions.activeSessionCount())
    if (decision.shouldPrompt && mainWindow && !mainWindow.isDestroyed()) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Unsaved changes',
        message: decision.message,
      })
      if (choice === 1) {
        e.preventDefault()
      }
    }
  })

  rebuildApplicationMenu()

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function readApprovalMode(tools: ToolRegistry): ApprovalMode {
  const workspacePath = tools.getWorkspacePath()
  if (!workspacePath) return 'normal'

  try {
    const settingsPath = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(settingsPath)) return 'normal'
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as {
      automationApprovalMode?: string
    }
    if (
      raw.automationApprovalMode === 'normal' ||
      raw.automationApprovalMode === 'strict' ||
      raw.automationApprovalMode === 'developer'
    ) {
      return raw.automationApprovalMode
    }
  } catch {
    return 'normal'
  }

  return 'normal'
}

app.setName('Mim')
configureLinuxCommandLine(app.commandLine)

app.whenReady().then(() => {
  // Dev dock icon (packaged builds get the icon from electron-builder config).
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = join(__dirname, '../../resources/icon.png')
    if (existsSync(iconPath)) app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }
  return boot()
})

app.on('before-quit', () => {
  clearAppUpdateTimers()
  if (historyBaselineTimer != null) {
    clearTimeout(historyBaselineTimer)
    historyBaselineTimer = null
  }
  void telemetryShutdown?.()
  telemetryShutdown = null
  void workspaceFileWatcher?.close()
  workspaceFileWatcher = null
  deleteMcpDiscoveryFile(HOME_DIR)
  closeSearchDb()
})

app.on('window-all-closed', () => {
  app.quit()
})
