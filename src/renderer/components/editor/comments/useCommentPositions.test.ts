import { describe, expect, it } from 'vitest'
import { layoutCommentCards } from './useCommentPositions.js'

describe('layoutCommentCards', () => {
  it('keeps separated cards at their anchor positions', () => {
    expect(layoutCommentCards({
      anchors: [
        { id: 'a', top: 40 },
        { id: 'b', top: 240 },
      ],
      cardHeights: { a: 80, b: 80 },
    }).map(item => ({ id: item.id, top: item.top }))).toEqual([
      { id: 'a', top: 40 },
      { id: 'b', top: 240 },
    ])
  })

  it('pushes colliding neighbors down when there is no active card', () => {
    expect(layoutCommentCards({
      anchors: [
        { id: 'a', top: 40 },
        { id: 'b', top: 70 },
        { id: 'c', top: 90 },
      ],
      cardHeights: { a: 50, b: 50, c: 50 },
      gap: 8,
    }).map(item => ({ id: item.id, top: item.top }))).toEqual([
      { id: 'a', top: 40 },
      { id: 'b', top: 98 },
      { id: 'c', top: 156 },
    ])
  })

  it('pins the active card and pushes both sides away', () => {
    expect(layoutCommentCards({
      anchors: [
        { id: 'before', top: 130 },
        { id: 'active', top: 160 },
        { id: 'after', top: 170 },
      ],
      cardHeights: { before: 40, active: 60, after: 40 },
      activeId: 'active',
      gap: 10,
    }).map(item => ({ id: item.id, top: item.top }))).toEqual([
      { id: 'before', top: 110 },
      { id: 'active', top: 160 },
      { id: 'after', top: 230 },
    ])
  })

  it('shifts an active-first stack back into the rail when it underflows', () => {
    expect(layoutCommentCards({
      anchors: [
        { id: 'before', top: 20 },
        { id: 'active', top: 40 },
      ],
      cardHeights: { before: 50, active: 50 },
      activeId: 'active',
      gap: 8,
      topPadding: 10,
    }).map(item => ({ id: item.id, top: item.top }))).toEqual([
      { id: 'before', top: 10 },
      { id: 'active', top: 68 },
    ])
  })
})
