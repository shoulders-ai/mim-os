import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCurrentDocument,
  getCurrentDocumentSummary,
  notifyCurrentDocumentChanged,
  registerCurrentDocumentProvider,
  subscribeCurrentDocument,
} from './currentDocument.js'

let disposeProvider: (() => void) | null = null
let unsubscribe: (() => void) | null = null

afterEach(() => {
  disposeProvider?.()
  unsubscribe?.()
  disposeProvider = null
  unsubscribe = null
})

describe('current document provider bridge', () => {
  it('returns null when no provider is registered', async () => {
    expect(await getCurrentDocument()).toBe(null)
    expect(await getCurrentDocumentSummary()).toBe(null)
  })

  it('normalizes provider output and summarizes without content', async () => {
    disposeProvider = registerCurrentDocumentProvider(() => ({
      id: 'tab-1',
      path: 'docs/plan.md',
      content: '# Plan',
      dirty: true,
    }))

    expect(await getCurrentDocument()).toEqual({
      id: 'tab-1',
      path: 'docs/plan.md',
      name: 'plan.md',
      mediaType: 'text/markdown',
      content: '# Plan',
      dirty: true,
    })
    expect(await getCurrentDocumentSummary()).toEqual({
      id: 'tab-1',
      path: 'docs/plan.md',
      name: 'plan.md',
      mediaType: 'text/markdown',
      dirty: true,
      size: 6,
    })
  })

  it('notifies listeners when providers register, update, and dispose', () => {
    const listener = vi.fn()
    unsubscribe = subscribeCurrentDocument(listener)

    disposeProvider = registerCurrentDocumentProvider(() => ({ name: 'Untitled', content: '' }))
    notifyCurrentDocumentChanged()
    disposeProvider()

    expect(listener).toHaveBeenCalledTimes(3)
  })
})
