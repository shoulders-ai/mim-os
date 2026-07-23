// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import WorkHost from './WorkHost.vue'
import type { WorkEntry } from '../../services/workbench/entries.js'
import type { WorkHostKind } from '../../services/workbench/hosts.js'

const childCalls = vi.hoisted(() => ({
  sendExternalMessage: vi.fn(),
  addTab: vi.fn(),
  closeActiveTab: vi.fn(),
  runCommand: vi.fn(),
  sendText: vi.fn(),
}))

vi.mock('../chat/ChatView.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'ChatViewStub',
      props: ['sessionId', 'draft'],
      emits: ['openFile', 'archiveSession', 'sessionCreated'],
      setup(props, { expose, emit }) {
        expose({ sendExternalMessage: childCalls.sendExternalMessage })
        return () => h('div', { 'data-testid': 'chat-view', 'data-session-id': props.sessionId, 'data-draft': props.draft ? 'true' : 'false' }, [
          h('button', {
            'data-testid': 'chat-open-file',
            onClick: () => emit('openFile', 'chat-note.md'),
          }, `Chat ${props.sessionId ?? ''}`),
          h('button', {
            'data-testid': 'chat-archive',
            onClick: () => emit('archiveSession', props.sessionId),
          }, 'Archive chat'),
          h('button', {
            'data-testid': 'chat-create-session',
            onClick: () => emit('sessionCreated', 's-new'),
          }, 'Create session'),
        ])
      },
    }),
  }
})

vi.mock('../terminal/TerminalPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'TerminalPanelStub',
      props: ['active'],
      setup(props, { expose }) {
        expose({
          tabs: [{ id: 'terminal-tab', ptyId: 42 }],
          activeTabId: 'terminal-tab',
          addTab: childCalls.addTab,
          closeActiveTab: childCalls.closeActiveTab,
          runCommand: childCalls.runCommand,
          sendText: childCalls.sendText,
        })
        return () => h('div', {
          'data-testid': 'terminal-panel',
          'data-active': props.active ? 'true' : 'false',
        }, 'Terminal')
      },
    }),
  }
})

vi.mock('../files/FilesWorkView.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'FilesWorkViewStub',
      props: ['active', 'refreshKey', 'recentFiles', 'activeFilePath'],
      emits: ['openFile', 'newFile', 'openFileDialog', 'pathMoved'],
      setup(props, { emit }) {
        return () => h('div', {
          'data-testid': 'files-view-root',
          'data-active': props.active ? 'true' : 'false',
          'data-refresh-key': String(props.refreshKey ?? ''),
          'data-recent-path': Array.isArray(props.recentFiles) ? props.recentFiles[0]?.path : '',
          'data-active-file-path': props.activeFilePath ?? '',
        }, [
          h('button', {
            'data-testid': 'files-view',
            onClick: () => emit('openFile', 'notes.md'),
          }, 'Files'),
          h('button', {
            'data-testid': 'files-path-moved',
            onClick: () => emit('pathMoved', { oldPath: 'notes.md', newPath: 'docs/notes.md', type: 'file' }),
          }, 'Moved'),
        ])
      },
    }),
  }
})

vi.mock('../activity/ActivityTrustView.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'ActivityTrustViewStub',
      props: ['active'],
      setup(props) {
        return () => h('div', {
          'data-testid': 'activity-trust-view',
          'data-active': props.active ? 'true' : 'false',
        }, 'Review')
      },
    }),
  }
})

vi.mock('../packages/PackageFrame.vue', async () => {
  const { defineComponent, h, ref } = await import('vue')
  return {
    default: defineComponent({
      name: 'PackageFrameStub',
      props: ['packageId', 'viewId'],
      setup(props) {
        const count = ref(0)
        return () => h('button', {
          'data-testid': 'package-frame',
          'data-view-id': props.viewId as string,
          onClick: () => { count.value += 1 },
        }, `${props.packageId as string}:${count.value}`)
      },
    }),
  }
})

vi.mock('../packages/PackageRunView.vue', async () => {
  const { defineComponent, h, ref } = await import('vue')
  return {
    default: defineComponent({
      name: 'PackageRunViewStub',
      props: ['packageId', 'runId'],
      emits: ['openPackage'],
      setup(props, { emit }) {
        const count = ref(0)
        return () => h('button', {
          'data-testid': 'package-run-view',
          'data-package-id': props.packageId as string,
          'data-run-id': props.runId as string,
          onClick: () => {
            count.value += 1
            emit('openPackage', props.packageId as string)
          },
        }, `${props.packageId as string}:${props.runId as string}:${count.value}`)
      },
    }),
  }
})

vi.mock('../agents/AgentSessionView.vue', async () => {
  const { defineComponent, h, ref } = await import('vue')
  return {
    default: defineComponent({
      name: 'AgentSessionViewStub',
      props: ['agentId', 'sessionId'],
      emits: ['openAgentSession'],
      setup(props, { emit }) {
        const count = ref(0)
        return () => h('button', {
          'data-testid': 'agent-session-view',
          'data-agent-id': props.agentId as string,
          'data-session-id': props.sessionId as string,
          onClick: () => {
            count.value += 1
            emit('openAgentSession', props.agentId as string, 'relaunched-session')
          },
        }, `${props.agentId as string}:${props.sessionId as string}:${count.value}`)
      },
    }),
  }
})

vi.mock('../archive/ArchiveBrowser.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'ArchiveBrowserStub',
      emits: ['openSession'],
      setup(_props, { emit }) {
        return () => h('button', {
          'data-testid': 'archive-browser',
          onClick: () => emit('openSession', 's1'),
        }, 'Archive')
      },
    }),
  }
})

vi.mock('../routines/RoutinesWorkView.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'RoutinesWorkViewStub',
      props: ['active'],
      emits: ['openFile', 'openSession'],
      setup(props, { emit }) {
        return () => h('div', {
          'data-testid': 'routines-view',
          'data-active': props.active ? 'true' : 'false',
        }, [
          h('button', {
            'data-testid': 'routines-open-file',
            onClick: () => emit('openFile', 'routines/new-routine.md'),
          }, 'Open routine file'),
          h('button', {
            'data-testid': 'routines-open-session',
            onClick: () => emit('openSession', 'routine-session'),
          }, 'Open routine session'),
        ])
      },
    }),
  }
})

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

describe('WorkHost', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>
  let hostRef: any

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    hostRef = ref(null)
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call: vi.fn() },
    })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function demoPackages() {
    return [{
      manifest: { id: 'demo', name: 'Demo', icon: '*', views: [{ id: 'main', label: 'Main', src: './index.html', role: 'work' }] },
      dir: '/packages/demo',
      source: 'mim',
    }]
  }

  function mountHost(activeHost: WorkHostKind, activeWork: WorkEntry | null = null, listeners = {}) {
    return mountReactiveHost(ref(activeHost), ref(activeWork), listeners)
  }

  function mountReactiveHost(
    activeHost: ReturnType<typeof ref<WorkHostKind>>,
    activeWork: ReturnType<typeof ref<WorkEntry | null>>,
    listeners = {},
    // Stable across re-renders, like the `packages` ref App.vue binds;
    // its identity only changes on packages:changed.
    packages = ref(demoPackages()),
  ) {
    app = createApp({
      setup() {
        return () => h(WorkHost, {
          ref: hostRef,
          activeHost: activeHost.value,
          activeWork: activeWork.value,
          packages: packages.value,
          port: 1234,
          recentFiles: [{ path: 'notes.md', name: 'notes.md' }],
          ...listeners,
        })
      },
    })
    app.mount(root)
    return { activeHost, activeWork, packages }
  }

  it('forwards chat and terminal commands through exposed host methods', async () => {
    const onOpenFile = vi.fn()
    mountHost('terminal', { id: 'work:terminal', kind: 'terminal', title: 'Terminal' }, { onOpenFile })
    await flushUi()

    await hostRef.value.runTerminalCommand('npm test')
    expect(childCalls.runCommand).toHaveBeenCalledWith('npm test')

    await hostRef.value.addTerminalTab()
    hostRef.value.closeTerminalTab()
    expect(childCalls.addTab).toHaveBeenCalledOnce()
    expect(childCalls.closeActiveTab).toHaveBeenCalledOnce()

    await hostRef.value.sendExternalMessage('hello')
    expect(childCalls.sendExternalMessage).toHaveBeenCalledWith('hello')

    root.querySelector<HTMLButtonElement>('[data-testid="chat-open-file"]')?.click()
    expect(onOpenFile).toHaveBeenCalledWith('chat-note.md')
  })

  it('forwards file path move notifications', async () => {
    const onPathMoved = vi.fn()
    mountHost('files', { id: 'work:files', kind: 'files', title: 'Files' }, { onPathMoved })
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="files-path-moved"]')?.click()

    expect(onPathMoved).toHaveBeenCalledWith({ oldPath: 'notes.md', newPath: 'docs/notes.md', type: 'file' })
  })

  it('mounts the terminal in the background before running a hidden command', async () => {
    mountHost('chat', {
      id: 'work:chat:s1',
      kind: 'chat',
      title: 'Chat',
      sessionId: 's1',
    })
    await flushUi()
    expect(root.querySelector('[data-testid="terminal-panel"]')).toBeNull()

    await hostRef.value.runTerminalCommand('npm test')
    await flushUi()

    expect(root.querySelector('[data-testid="terminal-panel"]')?.getAttribute('data-active')).toBe('false')
    expect(childCalls.runCommand).toHaveBeenCalledWith('npm test')
  })

  it('forwards archive requests from Chat to the app shell', async () => {
    const onArchiveSession = vi.fn()
    mountHost('chat', {
      id: 'work:chat:s2',
      kind: 'chat',
      title: 'Second',
      sessionId: 's2',
    }, { onArchiveSession })
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="chat-archive"]')?.click()

    expect(onArchiveSession).toHaveBeenCalledWith('s2')
  })

  it('opens draft chat work without a session id and promotes created sessions', async () => {
    const onOpenSession = vi.fn()
    mountHost('chat', {
      id: 'work:chat:new',
      kind: 'chat-draft',
      title: 'Chat',
    }, { onOpenSession })
    await flushUi()

    const chat = root.querySelector<HTMLElement>('[data-testid="chat-view"]')
    expect(chat?.dataset.draft).toBe('true')
    expect(chat?.dataset.sessionId).toBeUndefined()

    root.querySelector<HTMLButtonElement>('[data-testid="chat-create-session"]')?.click()
    expect(onOpenSession).toHaveBeenCalledWith('s-new')
  })

  it('passes chat Work identity into the Chat surface', async () => {
    mountHost('chat', {
      id: 'work:chat:s2',
      kind: 'chat',
      title: 'Second',
      sessionId: 's2',
    })
    await flushUi()

    expect(root.querySelector('[data-testid="chat-view"]')?.getAttribute('data-session-id')).toBe('s2')
  })

  it('keeps app views and Work-surface events behind the Work host boundary', async () => {
    const onOpenFile = vi.fn()
    const packageWork = {
      id: 'work:package-view:demo:main',
      kind: 'package-view',
      title: 'Demo',
      packageId: 'demo',
      viewId: 'main',
    } satisfies WorkEntry

    mountHost('files', packageWork, { onOpenFile })
    await flushUi()

    expect(root.querySelector('[data-testid="package-frame"]')?.textContent).toBe('demo:0')
    expect(root.querySelector('[data-testid="package-frame"]')?.getAttribute('data-view-id')).toBe('main')
    root.querySelector<HTMLButtonElement>('[data-testid="files-view"]')?.click()
    expect(onOpenFile).toHaveBeenCalledWith('notes.md')
  })

  it('keeps mounted Work surfaces alive when navigating between Work entries', async () => {
    const activeHost = ref<WorkHostKind>('terminal')
    const activeWork = ref<WorkEntry | null>({
      id: 'work:terminal',
      kind: 'terminal',
      title: 'Terminal',
    })
    mountReactiveHost(activeHost, activeWork)
    await flushUi()

    expect(root.querySelector('[data-testid="terminal-panel"]')).not.toBeNull()

    activeHost.value = 'files'
    activeWork.value = { id: 'work:files', kind: 'files', title: 'Files' }
    await flushUi()
    expect(root.querySelector('[data-testid="terminal-panel"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="files-view"]')).not.toBeNull()

    activeHost.value = 'archive'
    activeWork.value = { id: 'work:archive', kind: 'archive', title: 'Archive' }
    await flushUi()
    expect(root.querySelector('[data-testid="terminal-panel"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="files-view"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="archive-browser"]')).not.toBeNull()
  })

  it('passes active state and recent files into the Files surface', async () => {
    const activeHost = ref<WorkHostKind>('files')
    const activeWork = ref<WorkEntry | null>({ id: 'work:files', kind: 'files', title: 'Files' })
    app = createApp({
      setup() {
        return () => h(WorkHost, {
          activeHost: activeHost.value,
          activeWork: activeWork.value,
          packages: [],
          port: 1234,
          filesRefreshKey: 7,
          recentFiles: [{ path: 'notes.md', name: 'notes.md' }],
          activeFilePath: 'notes.md',
        })
      },
    })
    app.mount(root)
    await flushUi()

    const files = root.querySelector<HTMLElement>('[data-testid="files-view-root"]')
    expect(files?.dataset.active).toBe('true')
    expect(files?.dataset.refreshKey).toBe('7')
    expect(files?.dataset.recentPath).toBe('notes.md')
    expect(files?.dataset.activeFilePath).toBe('notes.md')

    activeHost.value = 'terminal'
    activeWork.value = { id: 'work:terminal', kind: 'terminal', title: 'Terminal' }
    await flushUi()

    expect(root.querySelector<HTMLElement>('[data-testid="files-view-root"]')?.dataset.active).toBe('false')
  })

  it('mounts Review as a real Work surface', async () => {
    mountHost('activity-trust', {
      id: 'work:activity-trust',
      kind: 'activity-trust',
      title: 'Review',
    })
    await flushUi()

    const view = root.querySelector<HTMLElement>('[data-testid="activity-trust-view"]')
    expect(view).not.toBeNull()
    expect(view?.dataset.active).toBe('true')
  })

  it('forwards Routines surface file and session opens', async () => {
    const onOpenFile = vi.fn()
    const onOpenSession = vi.fn()
    mountHost('routines', {
      id: 'work:routines',
      kind: 'routines',
      title: 'Routines',
    }, { onOpenFile, onOpenSession })
    await flushUi()

    expect(root.querySelector<HTMLElement>('[data-testid="routines-view"]')?.dataset.active).toBe('true')
    root.querySelector<HTMLButtonElement>('[data-testid="routines-open-file"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="routines-open-session"]')?.click()

    expect(onOpenFile).toHaveBeenCalledWith('routines/new-routine.md')
    expect(onOpenSession).toHaveBeenCalledWith('routine-session')
  })

  it('shows app runs as Work without reopening the app launcher', async () => {
    const onOpenPackage = vi.fn()
    mountHost('package-run', {
      id: 'work:package-run:demo:run-1',
      kind: 'package-run',
      title: 'Demo run',
      packageId: 'demo',
      runId: 'run-1',
    }, { onOpenPackage })
    await flushUi()

    const runView = root.querySelector<HTMLButtonElement>('[data-testid="package-run-view"]')
    expect(runView).not.toBeNull()
    expect(runView?.getAttribute('data-package-id')).toBe('demo')
    expect(runView?.getAttribute('data-run-id')).toBe('run-1')

    runView?.click()
    expect(onOpenPackage).toHaveBeenCalledWith('demo')
  })

  it('caches app Work views across Work navigation', async () => {
    const packageWork = ref<WorkEntry | null>({
      id: 'work:package-view:demo:main',
      kind: 'package-view',
      title: 'Demo',
      packageId: 'demo',
      viewId: 'main',
    })
    const activeHost = ref<WorkHostKind>('package-view')
    mountReactiveHost(activeHost, packageWork)
    await flushUi()

    const frame = root.querySelector<HTMLButtonElement>('[data-testid="package-frame"]')
    expect(frame?.textContent).toBe('demo:0')
    frame?.click()
    await flushUi()
    expect(root.querySelector('[data-testid="package-frame"]')?.textContent).toBe('demo:1')

    activeHost.value = 'files'
    packageWork.value = { id: 'work:files', kind: 'files', title: 'Files' }
    await flushUi()
    expect(root.querySelector('[data-testid="files-view"]')).not.toBeNull()

    activeHost.value = 'package-view'
    packageWork.value = {
      id: 'work:package-view:demo:main',
      kind: 'package-view',
      title: 'Demo',
      packageId: 'demo',
      viewId: 'main',
    }
    await flushUi()

    expect(root.querySelector('[data-testid="package-frame"]')?.textContent).toBe('demo:1')
  })

  it('keeps app frames in the DOM when navigating away so iframes never reload', async () => {
    const activeWork = ref<WorkEntry | null>({
      id: 'work:package-view:demo:main',
      kind: 'package-view',
      title: 'Demo',
      packageId: 'demo',
      viewId: 'main',
    })
    const activeHost = ref<WorkHostKind>('package-view')
    mountReactiveHost(activeHost, activeWork)
    await flushUi()

    const frame = root.querySelector<HTMLElement>('[data-testid="package-frame"]')
    expect(frame).not.toBeNull()

    activeHost.value = 'files'
    activeWork.value = { id: 'work:files', kind: 'files', title: 'Files' }
    await flushUi()

    // Still mounted (a detached iframe resets its browsing context), just hidden.
    const hidden = root.querySelector<HTMLElement>('[data-testid="package-frame"]')
    expect(hidden).not.toBeNull()
    expect(hidden?.style.display).toBe('none')
  })

  it('remounts app frames when the packages list changes and drops removed packages', async () => {
    const activeWork = ref<WorkEntry | null>({
      id: 'work:package-view:demo:main',
      kind: 'package-view',
      title: 'Demo',
      packageId: 'demo',
      viewId: 'main',
    })
    const activeHost = ref<WorkHostKind>('package-view')
    const { packages } = mountReactiveHost(activeHost, activeWork)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="package-frame"]')?.click()
    await flushUi()
    expect(root.querySelector('[data-testid="package-frame"]')?.textContent).toBe('demo:1')

    // Same package reloaded (new list identity): frame remounts on fresh code.
    packages.value = demoPackages()
    await flushUi()
    expect(root.querySelector('[data-testid="package-frame"]')?.textContent).toBe('demo:0')

    // Package removed: its frame is dropped entirely.
    packages.value = []
    await flushUi()
    expect(root.querySelector('[data-testid="package-frame"]')).toBeNull()
  })

  it('shows agent sessions as Work and re-emits relaunch navigation upward', async () => {
    const onOpenAgentSession = vi.fn()
    mountHost('agent-session', {
      id: 'work:agent-session:sess-1',
      kind: 'agent-session',
      title: 'Claude Code',
      agentId: 'claude-code',
      sessionId: 'sess-1',
    }, { onOpenAgentSession })
    await flushUi()

    const view = root.querySelector<HTMLButtonElement>('[data-testid="agent-session-view"]')
    expect(view).not.toBeNull()
    expect(view?.getAttribute('data-agent-id')).toBe('claude-code')
    expect(view?.getAttribute('data-session-id')).toBe('sess-1')

    view?.click()
    expect(onOpenAgentSession).toHaveBeenCalledWith('claude-code', 'relaunched-session')
  })

  it('caches agent session Work views across Work navigation', async () => {
    const activeWork = ref<WorkEntry | null>({
      id: 'work:agent-session:sess-1',
      kind: 'agent-session',
      title: 'Claude Code',
      agentId: 'claude-code',
      sessionId: 'sess-1',
    })
    const activeHost = ref<WorkHostKind>('agent-session')
    mountReactiveHost(activeHost, activeWork)
    await flushUi()

    const view = root.querySelector<HTMLButtonElement>('[data-testid="agent-session-view"]')
    expect(view?.textContent).toBe('claude-code:sess-1:0')
    view?.click()
    await flushUi()
    expect(root.querySelector('[data-testid="agent-session-view"]')?.textContent).toBe('claude-code:sess-1:1')

    activeHost.value = 'files'
    activeWork.value = { id: 'work:files', kind: 'files', title: 'Files' }
    await flushUi()
    expect(root.querySelector('[data-testid="files-view"]')).not.toBeNull()

    activeHost.value = 'agent-session'
    activeWork.value = {
      id: 'work:agent-session:sess-1',
      kind: 'agent-session',
      title: 'Claude Code',
      agentId: 'claude-code',
      sessionId: 'sess-1',
    }
    await flushUi()

    expect(root.querySelector('[data-testid="agent-session-view"]')?.textContent).toBe('claude-code:sess-1:1')
  })

  it('caches app run Work views across Work navigation', async () => {
    const activeWork = ref<WorkEntry | null>({
      id: 'work:package-run:demo:run-1',
      kind: 'package-run',
      title: 'Demo run',
      packageId: 'demo',
      runId: 'run-1',
    })
    const activeHost = ref<WorkHostKind>('package-run')
    mountReactiveHost(activeHost, activeWork)
    await flushUi()

    const runView = root.querySelector<HTMLButtonElement>('[data-testid="package-run-view"]')
    expect(runView?.textContent).toBe('demo:run-1:0')
    runView?.click()
    await flushUi()
    expect(root.querySelector('[data-testid="package-run-view"]')?.textContent).toBe('demo:run-1:1')

    activeHost.value = 'files'
    activeWork.value = { id: 'work:files', kind: 'files', title: 'Files' }
    await flushUi()
    expect(root.querySelector('[data-testid="files-view"]')).not.toBeNull()

    activeHost.value = 'package-run'
    activeWork.value = {
      id: 'work:package-run:demo:run-1',
      kind: 'package-run',
      title: 'Demo run',
      packageId: 'demo',
      runId: 'run-1',
    }
    await flushUi()

    expect(root.querySelector('[data-testid="package-run-view"]')?.textContent).toBe('demo:run-1:1')
  })

  it('exposes sendTerminalText that delegates to terminal sendText', async () => {
    mountHost('terminal', { id: 'work:terminal', kind: 'terminal', title: 'Terminal' })
    await flushUi()

    await hostRef.value.sendTerminalText('x <- 1', { spawn: { program: 'r' } })
    expect(childCalls.sendText).toHaveBeenCalledWith('x <- 1', { spawn: { program: 'r' } })
  })
})
