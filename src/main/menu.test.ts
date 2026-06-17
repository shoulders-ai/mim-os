import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
}))

const { buildMenuTemplate } = await import('@main/menu.js')

const callbacks = {
  onNewDocument: vi.fn(),
  onOpenFile: vi.fn(),
  onSaveFile: vi.fn(),
  onSaveFileAs: vi.fn(),
  onExportDocument: vi.fn(),
  onOpenRecent: vi.fn(),
  onClearRecent: vi.fn(),
  onCloseTab: vi.fn(),
  onOpenSettings: vi.fn(),
  onShowShortcuts: vi.fn(),
  onShowWelcome: vi.fn(),
}

function findMenu(template: any[], label: string) {
  return template.find(m => m.label === label)
}

describe('buildMenuTemplate', () => {
  it('prepends the app menu only on macOS', () => {
    const mac = buildMenuTemplate({ platform: 'darwin', appName: 'Mim', recentFiles: [], callbacks })
    expect(mac[0].label).toBe('Mim')

    const linux = buildMenuTemplate({ platform: 'linux', appName: 'Mim', recentFiles: [], callbacks })
    expect(linux[0].label).toBe('File')
  })

  it('exposes document creation, open, save, and recent actions in the File menu', () => {
    const template = buildMenuTemplate({ platform: 'linux', appName: 'Mim', recentFiles: [], callbacks })
    const file = findMenu(template, 'File')!.submenu as any[]
    const labels = file.map(i => i.label)

    expect(labels).toContain('New Document')
    expect(labels).toContain('Open File…')
    expect(labels).toContain('Save')
    expect(labels).toContain('Save As…')
    expect(labels).toContain('Open Recent')

    const openFile = file.find(i => i.label === 'Open File…')
    const newDocument = file.find(i => i.label === 'New Document')
    const saveFile = file.find(i => i.label === 'Save')
    const saveFileAs = file.find(i => i.label === 'Save As…')
    const exportDoc = file.find(i => i.label === 'Export…')
    expect(openFile.accelerator).toBe('CmdOrCtrl+O')
    expect(saveFile.accelerator).toBe('CmdOrCtrl+S')
    expect(saveFileAs.accelerator).toBe('CmdOrCtrl+Shift+S')
    expect(exportDoc.accelerator).toBe('CmdOrCtrl+Shift+E')
    newDocument.click()
    exportDoc.click()
    expect(callbacks.onNewDocument).toHaveBeenCalledOnce()
    expect(callbacks.onExportDocument).toHaveBeenCalledOnce()

    saveFile.click()
    saveFileAs.click()
    expect(callbacks.onSaveFile).toHaveBeenCalledOnce()
    expect(callbacks.onSaveFileAs).toHaveBeenCalledOnce()
  })

  it('lists recent files by basename and wires their click handlers', () => {
    const template = buildMenuTemplate({
      platform: 'linux',
      appName: 'Mim',
      recentFiles: ['notes/a.md', '/abs/path/report.md'],
      callbacks,
    })
    const recent = (findMenu(template, 'File')!.submenu as any[])
      .find(i => i.label === 'Open Recent')!.submenu as any[]

    expect(recent[0].label).toBe('a.md')
    expect(recent[1].label).toBe('report.md')

    recent[1].click()
    expect(callbacks.onOpenRecent).toHaveBeenCalledWith('/abs/path/report.md')
  })

  it('shows a disabled placeholder and disabled Clear when there are no recents', () => {
    const template = buildMenuTemplate({ platform: 'linux', appName: 'Mim', recentFiles: [], callbacks })
    const recent = (findMenu(template, 'File')!.submenu as any[])
      .find(i => i.label === 'Open Recent')!.submenu as any[]

    expect(recent[0]).toMatchObject({ label: 'No Recent Files', enabled: false })
    const clear = recent.find(i => i.label === 'Clear Recent')
    expect(clear.enabled).toBe(false)
  })

  it('owns Cmd+W via File ▸ Close Tab (routed to renderer, not window close)', () => {
    const template = buildMenuTemplate({ platform: 'darwin', appName: 'Mim', recentFiles: [], callbacks })
    const file = findMenu(template, 'File')!.submenu as any[]
    const closeTab = file.find(i => i.label === 'Close Tab')
    expect(closeTab.accelerator).toBe('CmdOrCtrl+W')
    expect(file.some(i => i.role === 'close')).toBe(false)

    closeTab.click()
    expect(callbacks.onCloseTab).toHaveBeenCalled()

    // The Window menu must not re-bind Cmd+W via a role: 'close' entry.
    const win = findMenu(template, 'Window')!.submenu as any[]
    expect(win.some(i => i.role === 'close')).toBe(false)
  })

  it('owns Cmd+, via a Settings… item on every platform', () => {
    const mac = buildMenuTemplate({ platform: 'darwin', appName: 'Mim', recentFiles: [], callbacks })
    const appMenu = mac[0].submenu as any[]
    const macSettings = appMenu.find(i => i.label === 'Settings…')
    expect(macSettings.accelerator).toBe('CmdOrCtrl+,')

    const linux = buildMenuTemplate({ platform: 'linux', appName: 'Mim', recentFiles: [], callbacks })
    const file = findMenu(linux, 'File')!.submenu as any[]
    const linuxSettings = file.find(i => i.label === 'Settings…')
    expect(linuxSettings.accelerator).toBe('CmdOrCtrl+,')

    macSettings.click()
    expect(callbacks.onOpenSettings).toHaveBeenCalledOnce()
  })

  it('enables Clear Recent when recents exist', () => {
    const template = buildMenuTemplate({ platform: 'linux', appName: 'Mim', recentFiles: ['a.md'], callbacks })
    const recent = (findMenu(template, 'File')!.submenu as any[])
      .find(i => i.label === 'Open Recent')!.submenu as any[]
    const clear = recent.find(i => i.label === 'Clear Recent')
    expect(clear.enabled).toBe(true)
  })

  it('includes a Help menu with Keyboard Shortcuts and Welcome items', () => {
    const template = buildMenuTemplate({ platform: 'darwin', appName: 'Mim', recentFiles: [], callbacks })
    const help = findMenu(template, 'Help')
    expect(help).toBeDefined()

    const items = help!.submenu as any[]
    const shortcuts = items.find(i => i.label === 'Keyboard Shortcuts')
    const welcome = items.find(i => i.label === 'Welcome to Mim')
    expect(shortcuts).toBeDefined()
    expect(welcome).toBeDefined()

    shortcuts.click()
    expect(callbacks.onShowShortcuts).toHaveBeenCalled()

    welcome.click()
    expect(callbacks.onShowWelcome).toHaveBeenCalled()
  })

  it('includes Find in the Edit menu without consuming the accelerator', () => {
    const template = buildMenuTemplate({ platform: 'darwin', appName: 'Mim', recentFiles: [], callbacks })
    const edit = findMenu(template, 'Edit')!.submenu as any[]
    const find = edit.find(i => i.label === 'Find…')
    expect(find).toBeDefined()
    expect(find.accelerator).toBe('CmdOrCtrl+F')
    // registerAccelerator=false: the shortcut is documented in the menu but
    // the keypress falls through to the focused web content (CodeMirror, xterm).
    expect(find.registerAccelerator).toBe(false)
  })
})
