// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useApprovalsStore, type ApprovalRequest } from './approvals.js'
import { useSessionStore } from './sessions.js'

function request(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: 'r1',
    toolName: 'fs.edit',
    actor: 'ai',
    sessionId: 's1',
    category: 'write',
    risk: 'medium',
    mode: 'normal',
    reason: '',
    params: { path: 'a.md' },
    ...over,
  }
}

describe('approvals store', () => {
  let respondGate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    respondGate = vi.fn().mockResolvedValue(true)
    ;(globalThis as { window?: unknown }).window = { kernel: { respondGate } }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queues a request and marks its conversation as needing approval', () => {
    const store = useApprovalsStore()
    const sessions = useSessionStore()
    store.enqueue(request())
    expect(store.forSession('s1')).toHaveLength(1)
    expect(sessions.sessionStatuses.s1).toBe('needs-approval')
  })

  it('ignores a duplicate request id', () => {
    const store = useApprovalsStore()
    store.enqueue(request())
    store.enqueue(request())
    expect(store.pendingCount).toBe(1)
  })

  it('only returns approvals for the matching conversation', () => {
    const store = useApprovalsStore()
    store.enqueue(request({ requestId: 'r1', sessionId: 's1' }))
    store.enqueue(request({ requestId: 'r2', sessionId: 's2' }))
    expect(store.forSession('s1').map(r => r.requestId)).toEqual(['r1'])
    expect(store.forSession(null)).toEqual([])
  })

  it('responds, clears the request, and reports the decision to the gate', async () => {
    const store = useApprovalsStore()
    const sessions = useSessionStore()
    store.enqueue(request())
    await store.respond('r1', { approved: true, alwaysAllow: true })
    expect(store.pendingCount).toBe(0)
    expect(sessions.sessionStatuses.s1).toBe('working')
    expect(respondGate).toHaveBeenCalledWith('r1', { approved: true, alwaysAllow: true })
  })

  it('sets the conversation to error when declined', async () => {
    const store = useApprovalsStore()
    const sessions = useSessionStore()
    store.enqueue(request())
    await store.respond('r1', { approved: false })
    expect(sessions.sessionStatuses.s1).toBe('error')
  })

  it('keeps the conversation waiting while another request is still pending', async () => {
    const store = useApprovalsStore()
    const sessions = useSessionStore()
    store.enqueue(request({ requestId: 'r1' }))
    store.enqueue(request({ requestId: 'r2' }))
    await store.respond('r1', { approved: true })
    expect(sessions.sessionStatuses.s1).toBe('needs-approval')
  })

  it('clearSession removes all pending approvals for that session', () => {
    const store = useApprovalsStore()
    store.enqueue(request({ requestId: 'r1', sessionId: 's1' }))
    store.enqueue(request({ requestId: 'r2', sessionId: 's1' }))
    store.enqueue(request({ requestId: 'r3', sessionId: 's2' }))

    store.clearSession('s1')

    expect(store.forSession('s1')).toHaveLength(0)
    expect(store.forSession('s2')).toHaveLength(1)
    expect(store.pendingCount).toBe(1)
  })

  it('clearSession is a no-op for unknown sessions', () => {
    const store = useApprovalsStore()
    store.enqueue(request({ requestId: 'r1', sessionId: 's1' }))
    store.clearSession('unknown')
    expect(store.pendingCount).toBe(1)
  })
})
