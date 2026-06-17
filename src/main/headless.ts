import { existsSync } from 'fs'
import { join } from 'path'
import { createTraceLog, type TraceLog } from '@main/trace/trace.js'
import { createTraceOutcomeTracker } from '@main/trace/outcomes.js'
import { loadUserConfig } from '@main/userConfig.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import {
  createPermissionGate,
  traceGateDecision,
  type PermissionApprovalRequest,
  type PermissionGate,
} from '@main/security/gate.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createPackageRuntime } from '@main/packages/packageRuntime.js'
import { createPackageJobRunner } from '@main/packages/packageJobs.js'
import { registerPackageRuntimeTools } from '@main/tools/packageRuntime.js'
import { createNamedPackageToolSync, type NamedPackageToolSync } from '@main/packages/namedPackageTools.js'
import { createAgentContextContributionsProvider, createLocalPackageStatusProvider } from '@main/packages/packageContributions.js'
import { setAgentContextContributionsProvider, setAgentContextLocalPackagesProvider } from '@main/ai/agentContext.js'
import { registerAiTools } from '@main/ai/ai.js'
import { registerArchiveTools } from '@main/tools/archive.js'
import { registerCoreAppTools } from '@main/tools/coreApps.js'
import { registerRegistryTools } from '@main/tools/registryTools.js'
import { lookupRegistryEntry } from '@main/packages/registrySources.js'
import { registerInstallTools } from '@main/tools/install.js'
import { registerPackageTools } from '@main/tools/packages.js'
import { DEFAULT_CACHE_ROOT } from '@main/packages/cacheLayout.js'
import { registerDocumentTools } from '@main/tools/documents.js'
import { registerExportTools } from '@main/tools/export.js'
import { registerReferencesTools } from '@main/tools/references.js'
import { registerFileTools } from '@main/tools/fs.js'
import { registerCommentTools } from '@main/tools/comments.js'
import { registerSkillTools } from '@main/tools/skills.js'
import { registerLogbookTools } from '@main/tools/logbook.js'
import { registerSearchTools } from '@main/tools/search.js'
import { registerGitTools } from '@main/tools/git.js'
import { registerSyncTools } from '@main/tools/sync.js'
import { registerTraceTools } from '@main/tools/trace.js'
import { createHistoryStore } from '@main/history/history.js'
import { registerHistoryTools } from '@main/tools/history.js'
import { readTraceCaptureContent, readTraceRetentionDays, registerSettingsTools } from '@main/tools/settings.js'
import { registerSlackTools } from '@main/tools/slack.js'
import { registerGoogleTools } from '@main/tools/google.js'
import { registerWorkspaceTools } from '@main/tools/workspace.js'
import { registerSessionTools } from '@main/sessions.js'
import { resolveTelemetryConfig } from '@main/telemetry/config.js'
import { readTelemetryIdentity, setTelemetryIdentityEnabled } from '@main/telemetry/identity.js'
import { createTelemetry } from '@main/telemetry/telemetry.js'
import { registerTelemetryTools } from '@main/tools/telemetry.js'
import type { HttpClient } from '@main/integrations/http.js'
import { userHomeDir } from '@main/platform.js'

export interface HeadlessKernel {
  tools: ToolRegistry
  openWorkspace(path: string): Promise<void>
  shutdown(): Promise<void>
}

export interface HeadlessKernelOptions {
  approvals?: 'deny' | 'prompt' | 'allow'
  confirmApproval?: (request: PermissionApprovalRequest) => Promise<boolean>
  telemetry?: {
    enabled?: boolean
    endpoint?: string
    appVersion?: string
    allowInTests?: boolean
    http?: HttpClient
  }
}

export function createHeadlessKernel(options: HeadlessKernelOptions = {}): HeadlessKernel {
  let tools!: ToolRegistry
  const HOME = userHomeDir()
  const telemetryConfig = resolveTelemetryConfig({
    home: HOME,
    allowInTests: options.telemetry?.allowInTests,
  })
  let telemetryIdentity = telemetryConfig.disabled
    ? null
    : readTelemetryIdentity({ home: HOME })
  const telemetry = createTelemetry({
    http: options.telemetry?.http,
    appVersion: options.telemetry?.appVersion ?? process.env.npm_package_version ?? '0.1.0',
    platform: telemetryConfig.platform,
    runtime: 'headless',
    anonId: telemetryIdentity?.anonId ?? 'disabled',
    enabled: (options.telemetry?.enabled ?? telemetryIdentity?.enabled ?? false) && !telemetryConfig.disabled,
    locked: telemetryConfig.locked,
    endpoint: options.telemetry?.endpoint ?? telemetryConfig.endpoint,
    onEnabledChange: (enabled) => {
      telemetryIdentity = setTelemetryIdentityEnabled(enabled, { home: HOME })
    },
  })
  const traceLog = createTraceLog({
    sinks: [telemetry.createTelemetrySink()],
    devConsole: false,
    getPrincipal: () => {
      const user = loadUserConfig().user
      return user.email ?? user.name
    },
    getRetentionDays: () => readTraceRetentionDays(tools?.getWorkspacePath() ?? null),
  })
  let packages: Awaited<ReturnType<typeof createPackageLoader>> | null = null
  let packageEnablement: ReturnType<typeof createPackageEnablementStore> | null = null
  // Per-kernel, not module-scope: tests create several kernels in one process.
  let namedToolsRef: NamedPackageToolSync | null = null
  const gate = createHeadlessGate(() => tools.getWorkspacePath(), options, traceLog, (name) => namedToolsRef?.getPolicy(name))
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

  registerFileTools(tools)
  registerCommentTools(tools)
  registerWorkspaceTools(tools)
  registerSettingsTools(tools)
  registerSessionTools(tools)
  registerArchiveTools(tools)
  registerAiTools(tools)
  registerSearchTools(tools)
  registerGitTools(tools)
  registerSyncTools(tools)
  registerTraceTools(tools)
  registerHistoryTools(tools, history)
  registerDocumentTools(tools)
  // No hidden render window headless: export.docx works, export.pdf reports
  // its unavailability.
  registerExportTools(tools)
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
  })
  registerLogbookTools(tools)
  registerSlackTools(tools)
  registerGoogleTools(tools)
  registerTelemetryTools(tools, telemetry)
  registerCoreAppTools(tools)
  telemetry.track('app_open', {
    appVersion: options.telemetry?.appVersion ?? process.env.npm_package_version ?? '0.1.0',
    platform: telemetryConfig.platform,
    runtime: 'headless',
  })

  return {
    tools,
    async openWorkspace(path: string) {
      await tools.call('workspace.open', { path }, { actor: 'system' })
      telemetry.track('workspace_open')
      const enablement = createPackageEnablementStore({
        getWorkspacePath: () => tools.getWorkspacePath(),
      })
      packageEnablement = enablement
      packages = await createPackageLoader(tools)
      const runtime = createPackageRuntime({ packages, enablement, tools, trace: traceLog })
      const jobs = createPackageJobRunner({ runtime, getWorkspacePath: () => tools.getWorkspacePath(), emit: () => {}, trace: traceLog })
      registerPackageRuntimeTools(tools, packages, runtime, jobs, {})

      const namedTools = createNamedPackageToolSync({ runtime, tools, packages })
      namedToolsRef = namedTools
      registerPackageTools(tools, packages, enablement, {
        invalidate: (id) => runtime.invalidate(id),
        syncNamedTools: async () => { await namedTools.sync() },
      })

      registerCoreAppTools(tools, {
        packages,
        enablement,
        invalidate: (id) => { runtime.invalidate(id); void namedTools.sync() },
      })

      setAgentContextContributionsProvider(createAgentContextContributionsProvider({ runtime, packages }))
      setAgentContextLocalPackagesProvider(createLocalPackageStatusProvider({ runtime, packages, enablement }))
      await namedTools.sync()

      const cacheRoot = DEFAULT_CACHE_ROOT
      const globalDir = join(HOME, '.mim', 'packages')

      registerRegistryTools(tools, { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => tools.getWorkspacePath() })

      registerInstallTools(tools, {
        packages,
        enablement,
        cacheRoot,
        globalDir,
        clock: () => Date.now(),
        lookupRegistryEntry: (id, version) => lookupRegistryEntry(id, {
          workspacePath: tools.getWorkspacePath(),
          cacheRoot,
          version,
          isSourceTrusted: (s) => enablement.isRegistryTrusted(s),
        }),
      })
    },
    async shutdown() {
      namedToolsRef = null
      packageEnablement = null
      setAgentContextContributionsProvider(null)
      setAgentContextLocalPackagesProvider(null)
      await Promise.allSettled([
        telemetry.shutdown(),
        packages?.close?.(),
      ])
      packages = null
    },
  }
}

function createHeadlessGate(
  getWorkspacePath: () => string | null,
  options: HeadlessKernelOptions,
  traceLog: TraceLog,
  getDynamicToolPolicy: (name: string) => ReturnType<NamedPackageToolSync['getPolicy']>,
): PermissionGate {
  const approvals = options.approvals ?? 'deny'
  let gate!: PermissionGate

  gate = createPermissionGate({
    getApprovalMode: () => 'normal',
    getWorkspacePath,
    getDynamicToolPolicy,
    recordDecision: (event) => traceGateDecision(traceLog, event),
    sendApprovalRequest(request) {
      if (approvals === 'deny') return false
      queueMicrotask(async () => {
        try {
          const approved = approvals === 'allow'
            ? true
            : await (options.confirmApproval?.(request) ?? Promise.resolve(false))
          gate.respond(request.requestId, { approved })
        } catch {
          gate.respond(request.requestId, { approved: false })
        }
      })
      return true
    },
  })

  return gate
}
