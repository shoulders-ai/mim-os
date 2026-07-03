// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RunRow from './RunRow.vue'
import { usePingsStore } from '../../stores/pings.js'
import type { NavigatorRun } from '../../stores/runs.js'

function makeRun(overrides: Partial<NavigatorRun> = {}): NavigatorRun {
  return {
    id: 'agent:a1',
    kind: 'agent-session',
    sourceId: 'a1',
    title: 'Claude Code',
    status: 'done',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('RunRow ping indicator', () => {
  let pinia: Pinia
  let host: HTMLElement
  let app: App | null = null

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    app?.unmount()
    app = null
    host.remove()
  })

  function mount(run: NavigatorRun) {
    app = createApp(RunRow, { run, active: false })
    app.use(pinia)
    app.mount(host)
  }

  it('shows no indicator when the row is not armed', () => {
    mount(makeRun())
    expect(host.querySelector('[data-testid="ping-indicator"]')).toBeNull()
  })

  it('shows a quiet bell when armed', async () => {
    const pings = usePingsStore()
    pings.toggle('agent:a1')
    mount(makeRun())
    await nextTick()
    const indicator = host.querySelector('[data-testid="ping-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator!.getAttribute('title')).toMatch(/ping/i)
  })

  it('shows a prominent outcome tag after the ping fires', async () => {
    const pings = usePingsStore()
    pings.toggle('agent:a1')
    pings.settled.set('agent:a1', 'done')
    mount(makeRun())
    await nextTick()
    const tag = host.querySelector('[data-testid="ping-outcome"]')
    expect(tag).not.toBeNull()
    expect(tag!.textContent).toContain('Done')
  })

  it('styles an error outcome as an error', async () => {
    const pings = usePingsStore()
    pings.toggle('agent:a1')
    pings.settled.set('agent:a1', 'error')
    mount(makeRun({ status: 'error' }))
    await nextTick()
    const tag = host.querySelector('[data-testid="ping-outcome"]')
    expect(tag).not.toBeNull()
    expect(tag!.textContent).toContain('Error')
    expect(tag!.className).toContain('text-rem')
  })
})
