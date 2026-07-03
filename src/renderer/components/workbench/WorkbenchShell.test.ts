// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import WorkbenchShell from './WorkbenchShell.vue'
import NavigatorPane from './NavigatorPane.vue'
import WorkPane from './WorkPane.vue'
import ArtifactPane from './ArtifactPane.vue'

describe('WorkbenchShell panes', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null

  afterEach(() => {
    app?.unmount()
    app = null
    root?.remove()
    vi.restoreAllMocks()
  })

  function mount(component: Parameters<typeof createApp>[0]) {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(component)
    app.mount(root)
  }

  it('renders the Navigator, Work, and Artifact slots inside one shell body', async () => {
    mount({
      render: () => h(WorkbenchShell, { dragging: true }, {
        navigator: () => h(NavigatorPane, null, () => h('div', { id: 'navigator' }, 'Navigator')),
        work: () => h(WorkPane, { title: 'Work' }, () => h('div', { id: 'work' }, 'Work')),
        artifact: () => h(ArtifactPane, { title: 'Artifact' }, () => h('div', { id: 'artifact' }, 'Artifact')),
        overlays: () => h('div', { id: 'overlays' }, 'Overlays'),
      }),
    })
    await nextTick()

    const body = root.querySelector('[data-pane-shell="body"]') as HTMLElement
    expect(root.querySelector('[data-pane-shell="workbench"]')).toBeTruthy()
    expect(body).toBeTruthy()
    expect(root.querySelector('[data-pane="navigator"] #navigator')).toBeTruthy()
    expect(body.querySelector('[data-pane="work"] #work')).toBeTruthy()
    expect(body.querySelector('[data-pane="artifact"] #artifact')).toBeTruthy()
    expect(root.querySelector('#header')).toBeNull()
    expect(root.querySelector('#banner')).toBeNull()
    expect(root.querySelector('#overlays')).toBeTruthy()
  })

  it('always mounts its Navigator slot (collapse lives in ShellSidebar, not the pane)', async () => {
    // The Navigator never fully unmounts: ShellSidebar renders the icon rail or
    // the full tray itself, so NavigatorPane is a plain always-present slot.
    mount({
      render: () => h(NavigatorPane, null, () => h('div', { id: 'navigator' }, 'Navigator')),
    })
    await nextTick()

    expect(root.querySelector('[data-pane="navigator"]')).toBeTruthy()
    expect(root.querySelector('[data-pane="navigator"] #navigator')).toBeTruthy()
  })

  it('keeps the body flush at all window edges (no floating-card moat)', async () => {
    // Edge-to-edge instrument: Navigator, Work, and Artifact run flush to
    // every window edge. There is no top/side/bottom canvas moat and no
    // left-gutter toggle when the Navigator collapses — depth comes from
    // hairline dividers and the chrome gradient, not cards on a canvas.
    const navigatorCollapsed = ref(false)
    mount({
      setup: () => ({ navigatorCollapsed }),
      components: { WorkbenchShell, NavigatorPane, WorkPane },
      template: `
        <WorkbenchShell>
          <template #navigator><NavigatorPane><div id="navigator">Navigator</div></NavigatorPane></template>
          <template #work><WorkPane title="Work"><div id="work">Work</div></WorkPane></template>
        </WorkbenchShell>
      `,
    })
    await nextTick()

    const body = root.querySelector<HTMLElement>('[data-pane-shell="body"]')
    for (const cls of ['pt-2', 'pr-1', 'pb-2.5', 'pl-1', 'pl-0']) {
      expect(body?.className).not.toContain(cls)
    }

    // Collapsing the Navigator no longer touches the body gutters.
    navigatorCollapsed.value = true
    await nextTick()
    for (const cls of ['pt-2', 'pr-1', 'pb-2.5', 'pl-1', 'pl-0']) {
      expect(body?.className).not.toContain(cls)
    }
  })

  it('rails Work while keeping Work view state mounted', async () => {
    const state = ref<'expanded' | 'rail'>('expanded')
    mount({
      setup: () => ({ state }),
      components: { WorkPane },
      template: `
        <WorkPane :state="state" title="Files" subtitle="Work" meta="Files">
          <input id="draft" value="unsent draft" />
        </WorkPane>
      `,
    })
    await nextTick()

    const pane = root.querySelector('[data-pane="work"]') as HTMLElement
    expect(root.querySelector('#draft')).toBeTruthy()
    expect(root.querySelector('button[title="Show Work: Files"]')).toBeNull()

    state.value = 'rail'
    await nextTick()

    expect(root.querySelector('#draft')).toBeTruthy()
    expect(pane.querySelector('button[title="Show Work: Files"]')).toBeTruthy()
    expect(root.querySelector('button[title="Show Work: Files"]')).toBeTruthy()
  })

  it('melts the Work pane into the collapsed Navigator chrome when left-connected', async () => {
    // Edge-to-edge + collapsed Navigator: the rail + Work header form one
    // continuous chrome-high L. The header drops its bottom border and the
    // content carries the left + top hairline that outlines the pane against
    // the rail. No card rounding anywhere.
    mount({
      components: { WorkPane },
      template: `
        <WorkPane title="Files" subtitle="Work" :left-connected="true">
          <input id="draft" value="unsent draft" />
        </WorkPane>
      `,
    })
    await nextTick()

    const frame = root.querySelector('[data-pane="work"] > div') as HTMLElement
    const content = frame.lastElementChild as HTMLElement
    expect(frame.className).toContain('bg-chrome')
    expect(frame.className).not.toContain('rounded')
    // The content carries only the left hairline (outlines it against the
    // rail); the header keeps its own border-b so the surface starts at the
    // same y as the non-bridged state — no 1px shift on toggle.
    expect(content.className).toContain('border-l')
    expect(content.className).not.toContain('border-t')
    expect(content.className).toContain('bg-surface')
    expect(content.className).not.toContain('rounded')
  })

  it('renders the Work pane flush with no rounding when not left-connected', async () => {
    mount({
      components: { WorkPane },
      template: `
        <WorkPane title="Files" subtitle="Work">
          <input id="draft" value="unsent draft" />
        </WorkPane>
      `,
    })
    await nextTick()

    const frame = root.querySelector('[data-pane="work"] > div') as HTMLElement
    const content = frame.lastElementChild as HTMLElement
    expect(frame.className).not.toContain('rounded')
    expect(content.className).not.toContain('border-l')
    expect(content.className).toContain('bg-surface')
  })

  it('shows the restore icon at the top of the Work rail', async () => {
    mount({
      components: { WorkPane },
      template: `
        <WorkPane state="rail" title="Files" subtitle="Work" meta="Files">
          <input id="draft" value="unsent draft" />
        </WorkPane>
      `,
    })
    await nextTick()

    const rail = root.querySelector('button[title="Show Work: Files"]') as HTMLElement
    const topCap = rail.querySelector('span')
    expect(topCap?.querySelector('svg')).toBeTruthy()
    expect(root.querySelector('#draft')).toBeTruthy()
  })

  it('emits Artifact resize only from the visible split handle', async () => {
    const onResize = vi.fn()
    mount({
      render: () => h(ArtifactPane, { state: 'expanded', title: 'Artifact', expanded: false, onResize }, {
        default: () => h('div', { id: 'artifact-body' }, 'Artifact'),
      }),
    })
    await nextTick()

    root
      .querySelector('[data-testid="artifact-resize-handle"]')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }))

    expect(onResize).toHaveBeenCalledOnce()
    expect(root.querySelector('#artifact-body')).toBeTruthy()
  })

  it('keeps railed Artifact content mounted and removes the handle while railed or expanded', async () => {
    const state = ref<'expanded' | 'rail'>('rail')
    const expanded = ref(true)
    mount({
      setup: () => ({ state, expanded }),
      components: { ArtifactPane },
      template: `
        <ArtifactPane :state="state" title="README.md" subtitle="File" meta="File" :expanded="expanded">
          <div id="dirty-editor">dirty text</div>
        </ArtifactPane>
      `,
    })
    await nextTick()

    const pane = root.querySelector('[data-pane="artifact"]') as HTMLElement
    expect(root.querySelector('#dirty-editor')).toBeTruthy()
    expect(root.querySelector('[data-testid="artifact-resize-handle"]')).toBeNull()
    expect(pane.querySelector('button[title="Show Editor: README.md"]')).toBeTruthy()
    expect(root.querySelector('button[title="Show Editor: README.md"]')).toBeTruthy()

    state.value = 'expanded'
    expanded.value = false
    await nextTick()

    expect(root.querySelector('#dirty-editor')).toBeTruthy()
    expect(root.querySelector('[data-testid="artifact-resize-handle"]')).toBeTruthy()
    expect(pane.style.display).toBe('')
  })

  it('renders a persistent hairline divider inside the resize handle', async () => {
    // Edge-to-edge: the Work/Artifact divider is always a persistent 1px
    // hairline spanning the pane's full height (chrome-high header band +
    // surface content). There is no floating-gap / hover-only mode.
    mount({
      components: { ArtifactPane },
      template: `
        <ArtifactPane state="expanded" title="README.md" subtitle="File" meta="File" :expanded="false">
          <div id="artifact-body">Artifact</div>
        </ArtifactPane>
      `,
    })
    await nextTick()

    const handle = root.querySelector('[data-testid="artifact-resize-handle"]') as HTMLElement
    expect(handle).toBeTruthy()
    expect(handle.querySelector('.bg-rule-light')).toBeTruthy()
    expect(handle.querySelector('.bg-chrome-high')).toBeTruthy()
    expect(handle.querySelector('.bg-surface')).toBeTruthy()
  })
})
