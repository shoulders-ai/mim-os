import { describe, it, expect } from 'vitest'
import {
  rankPaletteItems,
  coreActions,
  coreSurfaces,
  type PaletteItem,
} from './commandPalette.js'

describe('rankPaletteItems', () => {
  const items: PaletteItem[] = [
    ...coreSurfaces(),
    ...coreActions(),
    { id: 'file:readme', kind: 'file', label: 'README.md', hint: '' },
    { id: 'file:index', kind: 'file', label: 'index.ts', hint: 'src/main' },
    { id: 'session:abc', kind: 'session', label: 'Fix the login bug', hint: 'Chat' },
  ]

  it('returns all items in kind-priority order when query is empty', () => {
    const ranked = rankPaletteItems('', items)
    expect(ranked.length).toBe(items.length)
    // Surfaces come first, then actions, then sessions, then files.
    const kinds = ranked.map(r => r.item.kind)
    const surfaceEnd = kinds.lastIndexOf('surface')
    const actionStart = kinds.indexOf('action')
    expect(surfaceEnd).toBeLessThan(actionStart)
  })

  it('returns only matching items for a query', () => {
    const ranked = rankPaletteItems('chat', items)
    const ids = ranked.map(r => r.item.id)
    expect(ids).toContain('surface:chat')
    expect(ids).toContain('action:new-chat')
    expect(ids).not.toContain('file:index')
  })

  it('ranks surfaces above actions for equal match quality', () => {
    const ranked = rankPaletteItems('chat', items)
    const chatSurface = ranked.find(r => r.item.id === 'surface:chat')
    const newChat = ranked.find(r => r.item.id === 'action:new-chat')
    expect(chatSurface).toBeDefined()
    expect(newChat).toBeDefined()
    expect(chatSurface!.score).toBeGreaterThan(newChat!.score)
  })

  it('returns match positions for highlighting', () => {
    const ranked = rankPaletteItems('set', items)
    const settings = ranked.find(r => r.item.id === 'action:settings')
    expect(settings).toBeDefined()
    expect(settings!.positions.length).toBeGreaterThan(0)
  })

  it('returns empty array when nothing matches', () => {
    expect(rankPaletteItems('zzzzz', items)).toEqual([])
  })

  it('respects the limit parameter', () => {
    const ranked = rankPaletteItems('', items, 3)
    expect(ranked.length).toBe(3)
  })

  it('matches files by name', () => {
    const ranked = rankPaletteItems('readme', items)
    expect(ranked.some(r => r.item.id === 'file:readme')).toBe(true)
  })

  it('matches sessions by label', () => {
    const ranked = rankPaletteItems('login', items)
    expect(ranked.some(r => r.item.id === 'session:abc')).toBe(true)
  })
})

describe('coreActions', () => {
  it('returns a non-empty array of action items', () => {
    const actions = coreActions()
    expect(actions.length).toBeGreaterThan(0)
    expect(actions.every(a => a.kind === 'action')).toBe(true)
  })

  it('uses New document as the document creation action', () => {
    expect(coreActions('MacIntel')).toContainEqual({
      id: 'action:new-document',
      kind: 'action',
      label: 'New document',
      hint: '⌘T',
    })
    expect(coreActions().some(action => action.id === 'action:new-file')).toBe(false)
  })

  it('uses platform-appropriate shortcut hints', () => {
    expect(coreActions('Linux x86_64')).toContainEqual({
      id: 'action:export-document',
      kind: 'action',
      label: 'Export document (PDF, Word)',
      hint: 'Ctrl+Shift+E',
    })
  })
})

describe('coreSurfaces', () => {
  it('returns a non-empty array of surface items', () => {
    const surfaces = coreSurfaces()
    expect(surfaces.length).toBeGreaterThan(0)
    expect(surfaces.every(s => s.kind === 'surface')).toBe(true)
  })

  it('includes Monitor as a first-class surface', () => {
    expect(coreSurfaces()).toContainEqual({
      id: 'surface:trust',
      kind: 'surface',
      label: 'Monitor',
      hint: '',
    })
  })

  it('does not include Editor as a Navigator surface', () => {
    expect(coreSurfaces().some(surface => surface.id === 'surface:editor')).toBe(false)
  })
})
