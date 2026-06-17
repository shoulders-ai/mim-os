// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import ActivityTrustView from './ActivityTrustView.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function clickByText(rootEl: ParentNode, text: string) {
  const button = [...rootEl.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  expect(button, `button "${text}"`).toBeTruthy()
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function clickContaining(rootEl: ParentNode, text: string) {
  const button = [...rootEl.querySelectorAll('button')].find(b => b.textContent?.includes(text))
  expect(button, `button containing "${text}"`).toBeTruthy()
  button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('ActivityTrustView', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>
  let call: ReturnType<typeof vi.fn>

  const stats = {
    events: { total: 8, errors: 2 },
    byTool: [{ tool: 'fs.write', calls: 2, successes: 1, errors: 1, errorRate: 0.5, avgDurationMs: 12, totalDurationMs: 24 }],
    byPackage: [{ packageId: 'slides', events: 3, errors: 1, errorRate: 1 / 3 }],
    byModel: [{ model: 'claude-sonnet-4-6', calls: 1, totalTokens: 300, estimatedCost: 0.012, avgDurationMs: 100 }],
    byDay: [{ day: '2026-06-12', events: 8, errors: 2, estimatedCost: 0.012 }],
    gates: [{ tool: 'gmail.send', allowed: 0, requested: 0, approved: 0, denied: 1, bypassed: 0, denialRate: 1, approvalRate: 0 }],
    jobs: [{ subject: 'slides.render', started: 1, completed: 0, failed: 1, cancelled: 0, avgDurationMs: 50 }],
    outcomes: { edits: 1, reverted: 1, avgDiffRatio: 0.8 },
  }

  // A clean chat run that edited a file, plus trust-relevant audit events.
  const events = [
    { ts: '2026-06-12T10:10:00.000Z', traceId: 'A', spanId: 'turnA', kind: 'chat.turn', actor: 'ai', model: 'claude-sonnet-4-6' },
    { ts: '2026-06-12T10:10:01.000Z', traceId: 'A', spanId: 'eA', parentSpanId: 'turnA', kind: 'tool.call', actor: 'ai', tool: 'fs.edit', effect: 'mutate', subject: 'docs/report.md' },
    { ts: '2026-06-12T10:10:01.600Z', traceId: 'A', spanId: 'eA', parentSpanId: 'turnA', kind: 'tool.result', actor: 'ai', tool: 'fs.edit', effect: 'mutate', status: 'ok', durationMs: 600 },
    { ts: '2026-06-12T10:10:02.000Z', traceId: 'A', spanId: 'mA', parentSpanId: 'turnA', kind: 'model.call', actor: 'ai', model: 'claude-sonnet-4-6', data: { totalTokens: 300, estimatedCost: 0.012 } },
    { ts: '2026-06-12T10:10:09.000Z', traceId: 'A', spanId: 'turnA', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 9000 },
    { ts: '2026-06-12T10:05:00.000Z', traceId: 'L', spanId: 'span-5', kind: 'outcome.edit', actor: 'system', subject: 'docs/report.md', data: { diffRatio: 0.8, reverted: true } },
    { ts: '2026-06-12T10:04:00.000Z', traceId: 'L', spanId: 'span-4', kind: 'package.http.request', actor: 'package', packageId: 'slides', packageVersion: '1.0.0', subject: 'api.example.com', status: 'ok', data: { method: 'GET' } },
    { ts: '2026-06-12T10:03:00.000Z', traceId: 'L', spanId: 'span-3', kind: 'gate.decision', actor: 'ai', tool: 'gmail.send', data: { decision: 'denied' } },
  ]

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'trace.stats') return stats
      if (tool === 'trace.query') {
        const traceId = params?.traceId as string | undefined
        return { events: traceId ? events.filter(e => e.traceId === traceId) : events, truncated: false }
      }
      if (tool === 'settings.get') return { value: 90 }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    Object.defineProperty(window, 'kernel', { configurable: true, value: { call } })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    document.body.querySelectorAll('[role="listbox"]').forEach(node => node.remove())
    vi.restoreAllMocks()
  })

  it('lands on Monitor with deterministic signal items and a narrated run feed', async () => {
    app = createApp(ActivityTrustView, { active: true })
    app.mount(root)
    await flushUi()

    expect(call).toHaveBeenCalledWith('trace.query', { days: 7, order: 'desc', limit: 500 })
    const monitor = root.querySelector('[data-testid="monitor-surface"]')
    expect(monitor?.textContent).toContain('notable events')
    expect(monitor?.textContent).toContain('You reverted docs/report.md')
    expect(monitor?.textContent).toContain('Denied gmail.send')
    const feed = root.querySelector('[data-testid="activity-feed"]')
    expect(feed?.textContent).toContain('Edited docs/report.md')
    expect(root.querySelector('[data-testid="activity-metrics"]')).toBeNull()
  })

  it('hides standalone single-shot model calls (task-label/summary) from the feed', async () => {
    // One chat send also fires a cheap task-label call on its own trace id. It
    // must not appear as its own "Model call" row masquerading as the chat.
    const withLabel = [
      ...events,
      { ts: '2026-06-12T10:10:10.000Z', traceId: 'TL', spanId: 'mL', kind: 'model.call', actor: 'ai', model: 'claude-haiku', data: { profile: 'task-label', totalTokens: 40, estimatedCost: 0.0001 } },
    ]
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'trace.stats') return stats
      if (tool === 'trace.query') {
        const traceId = params?.traceId as string | undefined
        return { events: traceId ? withLabel.filter(e => e.traceId === traceId) : withLabel, truncated: false }
      }
      if (tool === 'settings.get') return { value: 90 }
      throw new Error(`Unexpected tool: ${tool}`)
    })

    app = createApp(ActivityTrustView, { active: true })
    app.mount(root)
    await flushUi()

    const feed = root.querySelector('[data-testid="activity-feed"]')
    expect(feed?.textContent).toContain('Edited docs/report.md')
    expect(feed?.textContent).not.toContain('Model call')
  })

  it('opens a run into the Story and Timeline lenses', async () => {
    app = createApp(ActivityTrustView, { active: true })
    app.mount(root)
    await flushUi()

    clickContaining(root.querySelector('[data-testid="activity-feed"]')!, 'Edited docs/report.md')
    await flushUi()

    const runView = root.querySelector('[data-testid="run-view"]')
    expect(runView).toBeTruthy()
    // Scoped refetch for the single run, cap raised above the feed limit.
    expect(call).toHaveBeenCalledWith('trace.query', { traceId: 'A', days: 365, order: 'asc', limit: 5000 })

    const story = root.querySelector('[data-testid="run-story"]')
    expect(story?.textContent).toContain('Edited docs/report.md')
    expect(story?.textContent).not.toContain('Model')

    clickByText(runView!, 'Timeline')
    await flushUi()
    const tree = root.querySelector('[data-testid="span-tree"]')
    expect(tree?.textContent).toContain('Chat turn')
    expect(tree?.textContent).toContain('fs.edit')
  })

  it('shows important audit entries by default with full log behind the audit lens', async () => {
    app = createApp(ActivityTrustView, { active: true })
    app.mount(root)
    await flushUi()

    clickByText(root, 'Audit')
    await flushUi()

    const audit = root.querySelector('[data-testid="audit-view"]')
    expect(audit?.textContent).toContain('Denied gmail.send')
    expect(audit?.textContent).toContain('Mim requested fs.edit')
    expect(audit?.textContent).toContain('slides@1.0.0 contacted api.example.com')
    expect(audit?.textContent).toContain('You reverted docs/report.md')
    expect(audit?.textContent).not.toContain('Model call')

    clickByText(audit!, 'Full log')
    await flushUi()
    expect(audit?.textContent).toContain('Model call claude-sonnet-4-6')
  })
})
