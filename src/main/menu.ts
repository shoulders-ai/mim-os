import { Menu, type MenuItemConstructorOptions } from 'electron'
import { basename } from 'path'

export interface MenuCallbacks {
  onNewDocument: () => void
  onOpenFile: () => void
  onSaveFile: () => void
  onSaveFileAs: () => void
  onExportDocument: () => void
  onOpenRecent: (path: string) => void
  onClearRecent: () => void
  onCloseTab: () => void
  onOpenSettings: () => void
  onShowShortcuts: () => void
  onShowWelcome: () => void
}

export interface MenuTemplateOptions {
  platform: NodeJS.Platform
  appName: string
  recentFiles: string[]
  callbacks: MenuCallbacks
}

// Builds the application menu template. Kept free of Electron runtime calls so
// the structure can be asserted in tests. The File menu carries document
// creation, Open File, and Open Recent affordances; the remaining menus restore
// the standard roles that a custom menu would otherwise drop.
export function buildMenuTemplate(opts: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const isMac = opts.platform === 'darwin'
  const { callbacks } = opts

  const recentSubmenu: MenuItemConstructorOptions[] = opts.recentFiles.length
    ? opts.recentFiles.map(path => ({
        label: basename(path),
        toolTip: path,
        click: () => callbacks.onOpenRecent(path),
      }))
    : [{ label: 'No Recent Files', enabled: false }]

  recentSubmenu.push(
    { type: 'separator' },
    {
      label: 'Clear Recent',
      enabled: opts.recentFiles.length > 0,
      click: () => callbacks.onClearRecent(),
    },
  )

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: opts.appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        // Owns Cmd+, as a menu accelerator (same reasoning as Close Tab below):
        // a renderer keydown never fires while focus sits in a package webview.
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => callbacks.onOpenSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'New Document', click: () => callbacks.onNewDocument() },
      { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: () => callbacks.onOpenFile() },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => callbacks.onSaveFile() },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => callbacks.onSaveFileAs() },
      // Like Save, the accelerator routes through the menu app-wide; the
      // editor's own keydown handler covers focused-editor use.
      { label: 'Export…', accelerator: 'CmdOrCtrl+Shift+E', click: () => callbacks.onExportDocument() },
      { label: 'Open Recent', submenu: recentSubmenu },
      { type: 'separator' },
      // Owns Cmd/Ctrl+W as a menu accelerator so it reaches the renderer (close
      // the active tab) instead of the OS closing the whole window. Window close
      // stays available via the traffic-light button / Quit.
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => callbacks.onCloseTab() },
      ...(isMac
        ? []
        : [
            { type: 'separator' } as MenuItemConstructorOptions,
            { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => callbacks.onOpenSettings() } as MenuItemConstructorOptions,
            { role: 'quit' } as MenuItemConstructorOptions,
          ]),
    ],
  })

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      // Find is handled by the focused surface (CodeMirror's built-in search
      // panel, xterm find). The menu item documents the shortcut without
      // registering an accelerator so the keypress falls through to the
      // active web content.
      { label: 'Find…', registerAccelerator: false, accelerator: 'CmdOrCtrl+F' },
    ],
  })

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  })

  template.push({
    label: 'Window',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'zoom' }],
  })

  template.push({
    label: 'Help',
    submenu: [
      { label: 'Keyboard Shortcuts', click: () => callbacks.onShowShortcuts() },
      { label: 'Welcome to Mim', click: () => callbacks.onShowWelcome() },
    ],
  })

  return template
}

export function installApplicationMenu(opts: MenuTemplateOptions): void {
  const menu = Menu.buildFromTemplate(buildMenuTemplate(opts))
  Menu.setApplicationMenu(menu)
}
