import { beforeEach, describe, expect, it, vi } from 'vitest'

const browserWindowMock = vi.fn(() => ({
  webContents: {
    setWindowOpenHandler: vi.fn(),
  },
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  isDestroyed: vi.fn(() => false),
}))

vi.mock('electron', () => {
  const mockedElectron = {
    app: {
      setName: vi.fn(),
      whenReady: vi.fn(() => ({ then: vi.fn() })),
      on: vi.fn(),
      quit: vi.fn(),
      commandLine: { appendSwitch: vi.fn() },
      dock: undefined,
      name: 'Mim',
    },
    BrowserWindow: browserWindowMock,
    ipcMain: { handle: vi.fn() },
    shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder: vi.fn() },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
    nativeImage: { createFromPath: vi.fn() },
  }
  return {
    ...mockedElectron,
    default: mockedElectron,
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('@main/git.js', () => ({ cloneRepo: vi.fn() }))
vi.mock('@main/menu.js', () => ({ installApplicationMenu: vi.fn() }))
vi.mock('@main/server/server.js', () => ({ createServer: vi.fn(async () => ({ port: 12345, broadcast: vi.fn(), createPackageLaunchUrl: vi.fn(() => ''), createMcpToken: vi.fn(() => '1234567890123456'), revokeMcpToken: vi.fn(), close: vi.fn() })) }))
vi.mock('@main/tools/registry.js', () => ({ createToolRegistry: vi.fn(() => ({ register: vi.fn(), call: vi.fn(), getWorkspacePath: vi.fn(() => null) })) }))
vi.mock('@main/trace/trace.js', () => ({ createTraceLog: vi.fn(() => ({ append: vi.fn(), writePayload: vi.fn(), setWorkspacePath: vi.fn() })) }))
vi.mock('@main/packages/packages.js', () => ({ createPackageLoader: vi.fn(async () => ({ list: vi.fn(() => []), get: vi.fn(), onChange: vi.fn(), rescan: vi.fn() })) }))
vi.mock('@main/packages/packageEnablement.js', () => ({ createPackageEnablementStore: vi.fn(() => ({})) }))
vi.mock('@main/packages/packageRuntime.js', () => ({ createPackageRuntime: vi.fn(() => ({ invalidate: vi.fn() })) }))
vi.mock('@main/packages/packageJobs.js', () => ({ createPackageJobRunner: vi.fn(() => ({})) }))
vi.mock('@main/tools/fs.js', () => ({ registerFileTools: vi.fn() }))
vi.mock('@main/tools/workspace.js', () => ({ registerWorkspaceTools: vi.fn() }))
vi.mock('@main/tools/packages.js', () => ({ registerPackageTools: vi.fn() }))
vi.mock('@main/tools/packageRuntime.js', () => ({ registerPackageRuntimeTools: vi.fn() }))
vi.mock('@main/tools/bridge.js', () => ({ registerBridgeTools: vi.fn() }))
vi.mock('@main/tools/settings.js', () => ({ registerSettingsTools: vi.fn() }))
vi.mock('@main/sessions.js', () => ({ registerSessionTools: vi.fn() }))
vi.mock('@main/tools/archive.js', () => ({ registerArchiveTools: vi.fn() }))
vi.mock('@main/ai/ai.js', () => ({ registerAiTools: vi.fn() }))
vi.mock('@main/pty.js', () => ({ registerPtyTools: vi.fn() }))
vi.mock('@main/tools/search.js', () => ({ registerSearchTools: vi.fn() }))
vi.mock('@main/tools/documents.js', () => ({ registerDocumentTools: vi.fn() }))
vi.mock('@main/tools/skills.js', () => ({ registerSkillTools: vi.fn() }))
vi.mock('@main/packages/namedPackageTools.js', () => ({ createNamedPackageToolSync: vi.fn(() => ({ sync: vi.fn(), getPolicy: vi.fn(), diagnostics: vi.fn(() => []) })) }))
vi.mock('@main/packages/packageContributions.js', () => ({ createAgentContextContributionsProvider: vi.fn(() => async () => []) }))
vi.mock('@main/tools/coreApps.js', () => ({ registerCoreAppTools: vi.fn() }))
vi.mock('@main/tools/logbook.js', () => ({ registerLogbookTools: vi.fn() }))
vi.mock('@main/integrations/slack/tools.js', () => ({ registerSlackTools: vi.fn() }))
vi.mock('@main/integrations/google/tools.js', () => ({ registerGoogleTools: vi.fn() }))
vi.mock('@main/workspace/workspaceBoot.js', () => ({ resolveBootWorkspace: vi.fn(() => '/tmp'), recordLastWorkspace: vi.fn() }))
vi.mock('@main/attachments.js', () => ({ readAttachmentPaths: vi.fn(() => []) }))
vi.mock('@main/search/search.js', () => ({ initSearchDb: vi.fn(), closeSearchDb: vi.fn(), rebuildIndex: vi.fn() }))
vi.mock('@main/ai/systemPrompt.js', () => ({ getSystemPrompt: vi.fn(() => '') }))
vi.mock('@main/security/gate.js', () => ({ createPermissionGate: vi.fn(() => ({ respond: vi.fn() })), traceGateDecision: vi.fn() }))

describe('BrowserWindow security defaults', () => {
  beforeEach(() => {
    browserWindowMock.mockClear()
  })

  it('constructs BrowserWindow with secure webPreferences', async () => {
    const { createMainWindow } = await import('@main/index.js')
    createMainWindow()

    expect(browserWindowMock).toHaveBeenCalledTimes(1)
    const [options] = browserWindowMock.mock.calls[0] as [Record<string, any>]
    expect(options.webPreferences).toBeDefined()
    expect(options.webPreferences.preload).toMatch(/preload[\\/]index\.mjs$/)
    expect(options.webPreferences.sandbox).toBe(false)
    expect(options.webPreferences.webSecurity).not.toBe(false)
    expect(options.webPreferences.allowRunningInsecureContent).not.toBe(true)
  })

  it('enables native folder creation in open-directory dialogs', async () => {
    const { OPEN_DIRECTORY_DIALOG_PROPERTIES } = await import('@main/index.js')

    expect(OPEN_DIRECTORY_DIALOG_PROPERTIES).toContain('openDirectory')
    expect(OPEN_DIRECTORY_DIALOG_PROPERTIES).toContain('createDirectory')
  })

  it('uses inset traffic-light chrome only on macOS', async () => {
    const { mainWindowChromeOptions } = await import('@main/index.js')

    expect(mainWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    })
    expect(mainWindowChromeOptions('linux')).toEqual({})
    expect(mainWindowChromeOptions('win32')).toEqual({})
  })

  it('enables Wayland-friendly Ozone flags only on Linux', async () => {
    const { configureLinuxCommandLine } = await import('@main/index.js')
    const appendSwitch = vi.fn()

    configureLinuxCommandLine({ appendSwitch }, 'linux')
    expect(appendSwitch).toHaveBeenCalledWith('enable-features', 'UseOzonePlatform')
    expect(appendSwitch).toHaveBeenCalledWith('ozone-platform-hint', 'auto')

    appendSwitch.mockClear()
    configureLinuxCommandLine({ appendSwitch }, 'win32')
    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
