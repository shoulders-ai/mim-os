/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { EditorState, Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { extractOutline, outlineExtension } from './outline.js'

function outline(docText: string) {
  return extractOutline(Text.of(docText.split('\n')))
}

async function waitFor(predicate: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('extractOutline', () => {
  it('extracts headings with level, text, line number and offset', () => {
    const items = outline('intro\n\n# One\ntext\n## Two')
    expect(items).toEqual([
      { level: 1, text: 'One', line: 3, from: 7 },
      { level: 2, text: 'Two', line: 5, from: 18 },
    ])
  })

  it('supports all six heading levels', () => {
    const items = outline('# a\n## b\n### c\n#### d\n##### e\n###### f')
    expect(items.map((i) => i.level)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('ignores lines with more than six hashes or no space after the hashes', () => {
    expect(outline('####### too deep')).toEqual([])
    expect(outline('#nospace')).toEqual([])
  })

  it('accepts a tab between hashes and text', () => {
    expect(outline('#\tTitle')[0]).toMatchObject({ level: 1, text: 'Title' })
  })

  it('strips ATX closing hashes and trailing whitespace', () => {
    expect(outline('## Title ##')[0].text).toBe('Title')
    expect(outline('# Title   ')[0].text).toBe('Title')
  })

  it('removes inline markdown markup from heading text', () => {
    expect(outline('# **Bold** and `code` and _under_')[0].text).toBe('Bold and code and under')
  })

  it('unescapes backslash-escaped characters', () => {
    expect(outline('# Section \\#1')[0].text).toBe('Section #1')
  })

  it('collapses internal whitespace runs', () => {
    expect(outline('#  Spaced    out')[0].text).toBe('Spaced out')
  })

  it('returns an empty list for a doc without headings', () => {
    expect(outline('')).toEqual([])
    expect(outline('plain\ntext')).toEqual([])
  })
})

describe('outlineExtension', () => {
  function makeView(doc: string, onOutlineChange: (items: unknown[]) => void) {
    const state = EditorState.create({
      doc,
      extensions: [outlineExtension({ onOutlineChange, delay: 0 })],
    })
    return new EditorView({ state, parent: document.createElement('div') })
  }

  it('emits the initial outline after creation', async () => {
    const calls: unknown[][] = []
    const view = makeView('# Hello\ntext', (items) => calls.push(items))
    await waitFor(() => calls.length === 1)
    expect(calls[0]).toEqual([{ level: 1, text: 'Hello', line: 1, from: 0 }])
    view.destroy()
  })

  it('emits an updated outline after a doc change', async () => {
    const calls: unknown[][] = []
    const view = makeView('# Hello', (items) => calls.push(items))
    await waitFor(() => calls.length === 1)

    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n## World' } })
    await waitFor(() => calls.length === 2)
    expect(calls[1]).toEqual([
      { level: 1, text: 'Hello', line: 1, from: 0 },
      { level: 2, text: 'World', line: 2, from: 8 },
    ])
    view.destroy()
  })

  it('does not re-emit when an edit leaves the outline unchanged', async () => {
    const calls: unknown[][] = []
    const view = makeView('# Hello\ntext', (items) => calls.push(items))
    await waitFor(() => calls.length === 1)

    // Append after the heading: levels, lines and offsets all stay the same
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' more' } })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(calls.length).toBe(1)
    view.destroy()
  })

  it('does not emit after the view is destroyed', async () => {
    const calls: unknown[][] = []
    const view = makeView('# Hello', (items) => calls.push(items))
    view.destroy()
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(calls.length).toBe(0)
  })
})
