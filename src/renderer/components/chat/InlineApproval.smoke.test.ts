// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import InlineApproval from './InlineApproval.vue'

async function flush() {
  await Promise.resolve()
  await nextTick()
}

function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined
}

describe('InlineApproval', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
  })

  it('asks in plain language, shows the file, and summarizes the change', async () => {
    app = createApp(InlineApproval, {
      approval: {
        toolName: 'fs.edit',
        category: 'write',
        sessionId: 's1',
        params: { path: 'notes/plan.md' },
        preview: { kind: 'edit', oldText: 'a', newText: 'a\nb\nc' },
      },
      queueLength: 1,
    })
    app.mount(root)
    await flush()

    expect(root.textContent).toContain('Allow Mim to edit a file?')
    expect(root.textContent).toContain('notes/plan.md')
    expect(root.textContent).toContain('Adds 2 lines.')
    expect(button(root, 'Review change')).toBeTruthy()
    expect(button(root, 'Approve')).toBeTruthy()
    expect(button(root, 'Decline')).toBeTruthy()
  })

  it('reveals the exact tool call behind a Show details disclosure', async () => {
    app = createApp(InlineApproval, {
      approval: {
        toolName: 'fs.write',
        category: 'write',
        sessionId: 's1',
        params: { path: 'a.md', content: '[redacted]' },
        preview: { kind: 'write', content: 'x\ny' },
      },
    })
    app.mount(root)
    await flush()

    // collapsed by default
    expect(root.textContent).not.toContain('fs.write')
    button(root, 'Show details')!.click()
    await flush()
    expect(root.textContent).toContain('fs.write')
    expect(root.textContent).toContain('a.md')
  })

  it('previews the message body for an outbound send', async () => {
    app = createApp(InlineApproval, {
      approval: { toolName: 'slack.send', category: 'network', risk: 'high', sessionId: 's1', target: '#pricing', params: { channel: '#pricing', text: 'Q3 numbers are in' } },
    })
    app.mount(root)
    await flush()

    expect(root.textContent).toContain('Allow Mim to send a Slack message?')
    expect(root.textContent).toContain('Q3 numbers are in')
  })

  it('hides Review change when there is no before/after to show', async () => {
    app = createApp(InlineApproval, {
      approval: { toolName: 'terminal.run', category: 'system', sessionId: 's1', params: { command: 'rm -rf build' } },
    })
    app.mount(root)
    await flush()

    expect(root.textContent).toContain('Allow Mim to run a terminal command?')
    expect(root.textContent).toContain('rm -rf build')
    expect(button(root, 'Review change')).toBeFalsy()
  })

  it('surfaces a heads-up for sensitive targets', async () => {
    app = createApp(InlineApproval, {
      approval: { toolName: 'fs.write', category: 'write', sessionId: 's1', pathKind: 'sensitive', params: { path: '.env' }, preview: { kind: 'write' } },
    })
    app.mount(root)
    await flush()

    expect(root.textContent).toContain('sensitive')
  })

  it('emits approve with the remembered choice, decline, and review', async () => {
    const onApprove = vi.fn()
    const onDecline = vi.fn()
    const onReview = vi.fn()
    app = createApp(InlineApproval, {
      approval: { toolName: 'fs.edit', category: 'write', sessionId: 's1', params: { path: 'a.md' }, preview: { kind: 'edit' } },
      onApprove,
      onDecline,
      onReview,
    })
    app.mount(root)
    await flush()

    button(root, 'Approve')!.click()
    expect(onApprove).toHaveBeenLastCalledWith(false)

    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    await flush()
    button(root, 'Approve')!.click()
    expect(onApprove).toHaveBeenLastCalledWith(true)

    button(root, 'Decline')!.click()
    expect(onDecline).toHaveBeenCalled()
    button(root, 'Review change')!.click()
    expect(onReview).toHaveBeenCalled()
  })
})
