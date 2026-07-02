import { describe, expect, it } from 'vitest'
import { resolveDiffKeyAction, type DiffKeyStateLike, type DiffKeyTargetLike } from './diffKeyboard.js'

function key(over: Partial<KeyboardEvent> = {}) {
  return {
    key: 'Enter',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...over,
  }
}

function target(over: Partial<DiffKeyTargetLike> = {}): DiffKeyTargetLike {
  return { isEditable: false, inDiffScope: false, isButton: false, overlayOpen: false, ...over }
}

function state(over: Partial<DiffKeyStateLike> = {}): DiffKeyStateLike {
  return {
    active: true,
    busy: false,
    isApproval: false,
    isBatch: false,
    viewMode: 'diff',
    chunkCount: 2,
    allChunksResolved: false,
    ...over,
  }
}

describe('resolveDiffKeyAction', () => {
  it('does nothing when review is inactive, busy, already handled, or an overlay is open', () => {
    expect(resolveDiffKeyAction(key({ key: 'Escape' }), target(), state({ active: false }))).toBeNull()
    expect(resolveDiffKeyAction(key({ key: 'Escape' }), target(), state({ busy: true }))).toBeNull()
    expect(resolveDiffKeyAction(key({ key: 'Escape', defaultPrevented: true }), target(), state())).toBeNull()
    expect(resolveDiffKeyAction(key({ key: 'Escape' }), target({ overlayOpen: true }), state())).toBeNull()
  })

  it('ignores keys typed into editable surfaces outside the diff (chat composer, palette)', () => {
    expect(resolveDiffKeyAction(key({ key: 'Escape' }), target({ isEditable: true }), state())).toBeNull()
    expect(resolveDiffKeyAction(key({ metaKey: true }), target({ isEditable: true }), state())).toBeNull()
  })

  it('closes on Escape', () => {
    expect(resolveDiffKeyAction(key({ key: 'Escape' }), target(), state())).toBe('close')
    expect(resolveDiffKeyAction(key({ key: 'Escape' }), target({ isEditable: true, inDiffScope: true }), state())).toBe('close')
  })

  it('accepts on Mod+Enter, including while typing inside the diff editor', () => {
    expect(resolveDiffKeyAction(key({ metaKey: true }), target(), state())).toBe('accept')
    expect(resolveDiffKeyAction(key({ ctrlKey: true }), target({ isEditable: true, inDiffScope: true }), state())).toBe('accept')
  })

  it('approves on Mod+Enter when reviewing an approval request', () => {
    expect(resolveDiffKeyAction(key({ metaKey: true }), target(), state({ isApproval: true }))).toBe('approve')
  })

  it('accepts on plain Enter only once all chunks are resolved and nothing else owns Enter', () => {
    expect(resolveDiffKeyAction(key(), target(), state({ allChunksResolved: true }))).toBe('accept')
    expect(resolveDiffKeyAction(key(), target(), state())).toBeNull()
    expect(resolveDiffKeyAction(key(), target({ isButton: true }), state({ allChunksResolved: true }))).toBeNull()
    expect(resolveDiffKeyAction(key(), target({ isEditable: true, inDiffScope: true }), state({ allChunksResolved: true }))).toBeNull()
    expect(resolveDiffKeyAction(key(), target(), state({ allChunksResolved: true, isApproval: true }))).toBeNull()
  })

  it('navigates chunks on Alt+Arrow only in diff view with chunks', () => {
    expect(resolveDiffKeyAction(key({ key: 'ArrowDown', altKey: true }), target(), state())).toBe('next-chunk')
    expect(resolveDiffKeyAction(key({ key: 'ArrowUp', altKey: true }), target(), state())).toBe('prev-chunk')
    expect(resolveDiffKeyAction(key({ key: 'ArrowDown', altKey: true }), target(), state({ viewMode: 'result' }))).toBeNull()
    expect(resolveDiffKeyAction(key({ key: 'ArrowDown', altKey: true }), target(), state({ chunkCount: 0 }))).toBeNull()
    expect(resolveDiffKeyAction(key({ key: 'ArrowDown', altKey: true, metaKey: true }), target(), state())).toBeNull()
  })

  it('leaves unrelated keys alone', () => {
    expect(resolveDiffKeyAction(key({ key: 's', metaKey: true }), target(), state())).toBeNull()
    expect(resolveDiffKeyAction(key({ key: 'ArrowDown' }), target(), state())).toBeNull()
  })
})
