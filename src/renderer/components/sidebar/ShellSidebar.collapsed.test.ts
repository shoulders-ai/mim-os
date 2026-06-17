// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ShellSidebar from './ShellSidebar.vue'
import { useSessionStore, type Session } from '../../stores/sessions.js'
import { NAVIGATOR_SPINE_WIDTH } from '../../services/workbench/entries.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    label: 'Session 1',
    modelId: '',
    controlId: '',
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ShellSidebar collapsed rail', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let pinia: Pinia

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    setActivePinia(pinia)
    const sessions = [
      makeSession({ id: 's1', label: 'Refactor auth' }),
      makeSession({ id: 's2', label: 'pricing model' }),
    ]
    useSessionStore().sessions = sessions
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        // ShellSidebar's onMounted load() re-fetches the session list, so it must
        // return the same sessions or it would wipe the pre-seeded store.
        call: vi.fn(async (tool: string) => (tool === 'session.list' ? { sessions } : {})),
        on: vi.fn(),
        off: vi.fn(),
      },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  function mountSidebar(extra: Record<string, unknown> = {}) {
    app = createApp(ShellSidebar, {
      width: 240,
      collapsed: true,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Project Alpha',
      recentWorkspaces: [],
      port: 43211,
      ...extra,
    })
    app.use(pinia)
    app.mount(root)
  }

  function mountCollapsed(extra: Record<string, unknown> = {}) {
    mountSidebar({ collapsed: true, ...extra })
  }

  function mountExpanded(extra: Record<string, unknown> = {}) {
    mountSidebar({ collapsed: false, ...extra })
  }

  it('renders the fixed thin rail without the workspace picker', async () => {
    mountCollapsed()
    await flushUi()

    const aside = root.querySelector<HTMLElement>('aside.sb')
    expect(aside?.getAttribute('data-collapsed')).toBe('true')
    expect(aside?.style.width).toBe(`${NAVIGATOR_SPINE_WIDTH}px`)
    expect(root.querySelector('[data-testid="navigator-bridge-cap"]')).toBeTruthy()
    // No separate rail slab — the aside itself is the chrome-high surface.
    expect(root.querySelector('[data-testid="navigator-rail-surface"]')).toBeNull()
    expect(aside?.className).toContain('bg-chrome-high')
    expect(root.querySelector('[data-testid="workspace-row"]')).toBeNull()
    expect(root.textContent).not.toContain('Project Alpha')
  })

  it('keeps the rail free of expand controls (the bridged pane header owns expand)', async () => {
    // The traffic lights own the rail's top zone and the toggle must stay at
    // the top like every other pane toggle, so the expand affordance lives in
    // the bridged pane header right after the lights — never on the rail.
    mountCollapsed()
    await flushUi()

    expect(root.querySelector('[data-testid="navigator-expand"]')).toBeNull()
    // Settings stays the last footer row so its icon never moves on toggle.
    const footer = root.querySelector<HTMLElement>('[data-testid="sidebar-footer"]')
    const buttons = [...(footer?.querySelectorAll('button') ?? [])]
    expect(buttons[buttons.length - 1]?.getAttribute('title')).toBe('Settings')
  })

  it('keeps collapse in the expanded top chrome', async () => {
    const onToggle = vi.fn()
    mountExpanded({ onToggle })
    await flushUi()

    const topChrome = root.querySelector<HTMLElement>('[data-testid="navigator-top-chrome"]')
    const footer = root.querySelector<HTMLElement>('[data-testid="sidebar-footer"]')
    const collapse = root.querySelector<HTMLButtonElement>('[data-testid="navigator-collapse"]')

    expect(topChrome?.contains(collapse)).toBe(true)
    expect(collapse?.classList.contains('navigator-edge-toggle')).toBe(false)
    expect(footer?.querySelector('[data-testid="navigator-collapse"]')).toBeNull()
    expect(footer?.querySelector('[data-testid="navigator-expand"]')).toBeNull()

    collapse?.click()
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('renders fixed section markers in collapsed mode instead of removing headers', async () => {
    mountCollapsed()
    await flushUi()

    expect(root.querySelector('[data-testid="section-marker-apps"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-marker-activity"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-divider-apps"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-toggle-apps"]')).toBeNull()
    expect(root.querySelector('[data-testid="section-toggle-activity"]')).toBeNull()
    expect(root.textContent).not.toContain('Apps')
    expect(root.textContent).not.toContain('Activity')
  })

  it('renders labeled section markers in expanded mode', async () => {
    mountExpanded()
    await flushUi()

    expect(root.querySelector('[data-testid="section-marker-apps"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-marker-activity"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-toggle-apps"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-toggle-activity"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="section-divider-apps"]')).toBeNull()
    expect(root.textContent).toContain('Apps')
    expect(root.textContent).toContain('Activity')
  })

  it('uses the shared nav token class for rail rows', async () => {
    mountCollapsed()
    await flushUi()

    expect(root.querySelector('[data-work-key="chat"] .nav-token')).toBeTruthy()
    expect(root.querySelector('[data-testid="sidebar-footer"] .nav-token')).toBeTruthy()
    // Activity chips use the h-7 chip box (same 1.75rem as the nav-token)
    // with their own border, so their borders never overlap across the 1px
    // row gap. They share the nav-token's height but keep a distinct class.
    const chip = root.querySelector<HTMLElement>('[data-activity-key="chat:s1"] span')
    expect(chip?.className).not.toContain('nav-token')
    expect(chip?.className).toContain('h-7')
  })

  it('shows core surfaces as icon buttons without their labels', async () => {
    mountCollapsed()
    await flushUi()

    const workKeys = [...root.querySelectorAll('[data-work-key]')]
      .map(el => (el as HTMLElement).dataset.workKey)
    expect(workKeys).toEqual(['chat', 'files', 'terminal', 'trust'])
    // Labels are hidden in the rail; titles carry the name for hover.
    expect(root.textContent).not.toContain('Chat')
    expect(root.textContent).not.toContain('Monitor')
    expect(root.querySelector('[data-work-key="chat"]')?.getAttribute('title')).toBe('Chat')
    expect(root.querySelector('[data-work-key="trust"]')?.getAttribute('title')).toBe('Monitor')
  })

  it('keeps a new-chat token on the rail and leaves History to the expanded tray', async () => {
    // The Activity marker carries the + token in the rail so collapsed users
    // keep one-click new chat; History has no rail token by design.
    mountCollapsed()
    await flushUi()

    const newChat = root.querySelector<HTMLButtonElement>('[data-testid="activity-new-chat"]')
    expect(newChat).toBeTruthy()
    expect(newChat?.getAttribute('title')).toBe('New chat')
    expect(root.querySelector('[data-testid="activity-history"]')).toBeNull()
  })

  it('represents Activity chats as title-derived monograms in list order', async () => {
    mountCollapsed()
    await flushUi()

    const monograms = [...root.querySelectorAll('.activity-rail [data-activity-key]')]
      .map(el => el.textContent?.trim())
    expect(monograms).toContain('RA') // Refactor auth
    expect(monograms).toContain('PM') // pricing model
    // No full chat titles in the collapsed rail.
    expect(root.textContent).not.toContain('Refactor auth')
  })

  it('paints the Navigator as one flush chrome-high column in both states', async () => {
    // Edge-to-edge: the Navigator is a chrome-high column flush to the
    // window's left/top/bottom edges in BOTH states — the same tone as the
    // pane headers it bridges to, so the collapsed rail melts into the first
    // pane header and the expanded tray sits in the same chrome region as
    // the Work/Artifact headers. There is no separate rail slab; the aside
    // itself carries the chrome-high surface. No canvas moat, no rounding.
    mountCollapsed()
    await flushUi()

    const aside = root.querySelector<HTMLElement>('aside.sb')
    expect(aside?.className).toContain('bg-chrome-high')
    expect(aside?.getAttribute('data-collapsed')).toBe('true')
    // No separate slab element — the aside is the surface.
    expect(root.querySelector('[data-testid="navigator-rail-surface"]')).toBeNull()
  })

  it('keeps the pre-list stack rem-true so icons hold y at any root font size', async () => {
    // The app's root font-size is 14px (styles.css), so rem-based heights
    // scale together while pixel literals don't. cap (3rem) + mark (h-11 = 2.75rem)
    // + list pt-3 must equal the expanded top chrome (2.5rem) + workspace
    // row (pt-2 + h-9 = 2.75rem) + core list pt-5, so the first core token
    // holds y on toggle. The old pixel-literal h-[45px] pushed every icon
    // below it down ~8px on collapse.
    mountCollapsed()
    await flushUi()

    const mark = root.querySelector<HTMLElement>('[data-testid="workspace-mark"]')
    expect(mark?.className).toContain('h-11')
    expect(mark?.className).not.toContain('h-[45px]')
    expect(mark?.className).not.toContain('h-[calc(2.75rem+1px)]')
  })

  it('keeps Activity monogram chips the same box in both states', async () => {
    // Chips are h-7 w-7 (1.75rem) — the same box as the nav-token — left-
    // aligned to the px-3 lane so they sit flush under the icon tokens.
    // Identical classes in tray and rail: chips neither resize nor shift on
    // toggle, and bordered monograms never overlap across the 1px row gap.
    mountExpanded()
    await flushUi()

    const expandedChip = root.querySelector<HTMLElement>('[data-activity-key="chat:s1"] span')
    expect(expandedChip?.className).toContain('h-7')
    expect(expandedChip?.className).toContain('w-7')
    expect(expandedChip?.className).not.toContain('mx-px')

    app?.unmount()
    mountCollapsed()
    await flushUi()

    const railChip = root.querySelector<HTMLElement>('[data-activity-key="chat:s1"] span')
    expect(railChip?.className).toContain('h-7')
    expect(railChip?.className).toContain('w-7')
    expect(railChip?.className).not.toContain('mx-px')
  })

  it('stretches the workspace switcher across the tray row', async () => {
    // Buttons are shrink-to-fit by default, which left the picker hugging its
    // label; it should span the row like the nav rows below it.
    mountExpanded()
    await flushUi()

    const picker = root.querySelector<HTMLElement>('[data-testid="workspace-row"] button')
    expect(picker?.className).toContain('w-full')
    expect(picker?.querySelector('svg')).toBeTruthy()
  })

  it('floats Settings clear of the flush bottom edge in both states', async () => {
    // pb-3 lifts the Settings token above the flush bottom window edge
    // (edge-to-edge: no canvas moat) without the footer reading as an oversized
    // section. The footer classes are shared, so expanded and collapsed stay
    // in lockstep.
    mountCollapsed()
    await flushUi()
    expect(root.querySelector<HTMLElement>('[data-testid="sidebar-footer"]')?.className).toContain('pb-3')

    app?.unmount()
    mountExpanded()
    await flushUi()
    expect(root.querySelector<HTMLElement>('[data-testid="sidebar-footer"]')?.className).toContain('pb-3')
  })

  it('shows a passive workspace mark in the rail instead of the picker', async () => {
    mountCollapsed()
    await flushUi()

    const mark = root.querySelector<HTMLElement>('[data-testid="workspace-mark"]')
    expect(mark?.textContent?.trim()).toBe('PA') // Project Alpha
    expect(mark?.querySelector('button')).toBeNull()
    expect(root.querySelector('[data-testid="workspace-row"]')).toBeNull()
  })

  it('keeps the icon gutter at the same x in both states', async () => {
    mountExpanded()
    await flushUi()

    // Expanded: the flat header cluster sits on the same px-3 token lane
    // as the list, footer, and rail. The core-surface-list uses pr-3 pl-2
    // with pl-1 on buttons so the active bg has visible left padding while
    // icons stay at the same x (8 + 4 = 12px = px-3).
    expect(root.querySelector<HTMLElement>('[data-testid="workspace-row"]')?.className).toContain('px-3')
    expect(root.querySelector<HTMLElement>('[data-testid="core-surfaces"]')?.className).toContain('pl-2')
    expect(root.querySelector<HTMLElement>('[data-testid="navigator-list"]')?.className).toContain('px-3')
    expect(root.querySelector<HTMLElement>('[data-testid="sidebar-footer"]')?.className).toContain('px-3')
    expect(root.querySelector('[data-testid="workspace-mark"]')).toBeNull()

    app?.unmount()
    mountCollapsed()
    await flushUi()

    expect(root.querySelector<HTMLElement>('[data-testid="navigator-list"]')?.className).toContain('px-3')
    expect(root.querySelector<HTMLElement>('[data-testid="workspace-mark"]')?.className).toContain('px-3')
    expect(root.querySelector<HTMLElement>('[data-testid="sidebar-footer"]')?.className).toContain('px-3')
  })

  it('pins the flat header cluster above the scroll list with one rule', async () => {
    mountExpanded()
    await flushUi()

    // No card: the picker and core rows sit flat on the chrome, grouped by
    // proximity and a single full-bleed rule where the scroll region begins.
    expect(root.querySelector('[data-testid="header-card"]')).toBeNull()
    expect(root.querySelector('[data-testid="workspace-row"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="core-surfaces"]')).toBeTruthy()
    // The cluster is pinned above the scroll list; core surfaces never scroll away.
    expect(root.querySelector('[data-testid="navigator-list"] [data-testid="core-surfaces"]')).toBeNull()
    const rule = root.querySelector<HTMLElement>('[data-testid="core-rule"]')
    expect(rule?.className).toContain('border-t')
    expect(rule?.className).toContain('border-rule-light')

    app?.unmount()
    mountCollapsed()
    await flushUi()

    // The rail is already one chrome-high slab: no rule, core tokens stay in
    // the shared list lane.
    expect(root.querySelector('[data-testid="core-rule"]')).toBeNull()
    expect(root.querySelector('[data-testid="navigator-list"] [data-testid="core-surfaces"]')).toBeTruthy()
  })

  it('marks the active core rail token so the rail confirms the live surface', async () => {
    mountCollapsed({
      activeWorkId: 'work:files',
    })
    await flushUi()

    const files = root.querySelector<HTMLElement>('[data-work-key="files"]')
    const terminal = root.querySelector<HTMLElement>('[data-work-key="terminal"]')

    expect(files?.querySelector<HTMLElement>('.nav-token')?.className).toContain('bg-accent-tint')
    expect(files?.querySelector<HTMLElement>('.nav-token')?.className).toContain('text-accent')
    expect(terminal?.querySelector<HTMLElement>('.nav-token')?.className).not.toContain('bg-accent-tint')
    expect(terminal?.querySelector<HTMLElement>('.nav-token')?.className).not.toContain('text-accent')
  })

  it('sharpens the cluster rule only while the list is scrolled', async () => {
    // The rule is functional, not decorative: it marks where rows disappear
    // when the list scrolls, so it darkens only while that is happening.
    mountExpanded()
    await flushUi()

    const list = root.querySelector<HTMLElement>('[data-testid="navigator-list"]')!
    const rule = () => root.querySelector<HTMLElement>('[data-testid="core-rule"]')!
    expect(rule().className).toContain('border-rule-light')

    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 24 })
    list.dispatchEvent(new Event('scroll'))
    await flushUi()
    expect(rule().className).not.toContain('border-rule-light')
    expect(rule().className).toContain('border-rule')

    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 })
    list.dispatchEvent(new Event('scroll'))
    await flushUi()
    expect(rule().className).toContain('border-rule-light')
  })

  it('does not render the expanded top-chrome collapse control in the rail', async () => {
    mountCollapsed()
    await flushUi()

    expect(root.querySelector('[data-testid="navigator-collapse"]')).toBeNull()
  })
})
