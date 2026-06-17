import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { Strikethrough } from '@lezer/markdown'
import {
  detectActiveFormats,
  insertCitation,
  insertHorizontalRule,
  insertImage,
  insertLink,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCheckbox,
  toggleCode,
  toggleHeading,
  toggleItalic,
  toggleNumberedList,
  toggleStrikethrough,
} from './formatting.js'

/**
 * The formatting commands only use `view.state` and `view.dispatch`, so a
 * minimal fake view over a real EditorState is enough — no DOM required.
 */
function makeView(doc: string, anchor = 0, head = anchor) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage, extensions: [Strikethrough] })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return {
    get state() {
      return state
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state
      ensureSyntaxTree(state, state.doc.length, 5000)
    },
    doc() {
      return state.doc.toString()
    },
    sel() {
      const { anchor: a, head: h } = state.selection.main
      return { anchor: a, head: h }
    },
  }
}

function makeState(doc: string, cursor: number) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor),
    extensions: [markdown({ base: markdownLanguage, extensions: [Strikethrough] })],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}

describe('toggleBold', () => {
  it('inserts marker pair at empty selection and places cursor between them', () => {
    const view = makeView('hello ', 6)
    expect(toggleBold(view as any)).toBe(true)
    expect(view.doc()).toBe('hello ****')
    expect(view.sel()).toEqual({ anchor: 8, head: 8 })
  })

  it('wraps the selected text and keeps it selected inside the markers', () => {
    const view = makeView('hello world', 6, 11)
    toggleBold(view as any)
    expect(view.doc()).toBe('hello **world**')
    expect(view.sel()).toEqual({ anchor: 8, head: 13 })
  })

  it('unwraps when the selection exactly covers the content between markers', () => {
    const view = makeView('**word**', 2, 6)
    toggleBold(view as any)
    expect(view.doc()).toBe('word')
    expect(view.sel()).toEqual({ anchor: 0, head: 4 })
  })

  it('unwraps via syntax tree when cursor sits inside bold text with no selection', () => {
    const doc = 'a **bold** b'
    const view = makeView(doc, doc.indexOf('old'))
    toggleBold(view as any)
    expect(view.doc()).toBe('a bold b')
    expect(view.sel()).toEqual({ anchor: 3, head: 3 })
  })

  it('unwraps when the selection spans the whole node including markers', () => {
    const view = makeView('**word**', 0, 8)
    toggleBold(view as any)
    expect(view.doc()).toBe('word')
    expect(view.sel()).toEqual({ anchor: 0, head: 4 })
  })

  it('unwraps when a partial selection lies inside one bold node', () => {
    const view = makeView('**word**', 2, 4)
    toggleBold(view as any)
    expect(view.doc()).toBe('word')
  })

  it('strips flanking markers when the selection is exactly surrounded by them, even across nodes', () => {
    // Selection "a** mid **b" is flanked by ** on both sides, so the
    // string-boundary fallback removes those markers (it does not require
    // both endpoints to be in the same syntax node).
    const doc = '**a** mid **b**'
    const view = makeView(doc, 2, 13)
    toggleBold(view as any)
    expect(view.doc()).toBe('a** mid **b')
  })

  it('wraps a selection that spans two bold nodes without flanking markers', () => {
    const doc = 'x **a** y **b** z'
    // From just after "a" to just before the closing marker of "b"
    const view = makeView(doc, 5, 12)
    toggleBold(view as any)
    expect(view.doc()).toBe('x **a**** y ****b** z')
    // The original selection ("** y **") stays selected inside the new markers
    expect(view.sel()).toEqual({ anchor: 7, head: 14 })
  })
})

describe('toggleItalic', () => {
  it('wraps a selection in single asterisks', () => {
    const view = makeView('some word here', 5, 9)
    toggleItalic(view as any)
    expect(view.doc()).toBe('some *word* here')
    expect(view.sel()).toEqual({ anchor: 6, head: 10 })
  })

  it('unwraps when the cursor is inside emphasized text', () => {
    const doc = 'x *it* y'
    const view = makeView(doc, 4)
    toggleItalic(view as any)
    expect(view.doc()).toBe('x it y')
  })
})

describe('toggleCode', () => {
  it('wraps a selection in backticks', () => {
    const view = makeView('run cmd now', 4, 7)
    toggleCode(view as any)
    expect(view.doc()).toBe('run `cmd` now')
  })

  it('unwraps inline code when the cursor is inside it', () => {
    const doc = 'a `code` b'
    const view = makeView(doc, 4)
    toggleCode(view as any)
    expect(view.doc()).toBe('a code b')
  })
})

describe('toggleStrikethrough', () => {
  it('wraps a selection in double tildes', () => {
    const view = makeView('keep gone keep', 5, 9)
    toggleStrikethrough(view as any)
    expect(view.doc()).toBe('keep ~~gone~~ keep')
  })

  it('unwraps when the cursor is inside struck text', () => {
    const doc = 'a ~~gone~~ b'
    const view = makeView(doc, 5)
    toggleStrikethrough(view as any)
    expect(view.doc()).toBe('a gone b')
  })

  it('unwraps when the selection exactly covers the struck content', () => {
    const view = makeView('~~gone~~', 2, 6)
    toggleStrikethrough(view as any)
    expect(view.doc()).toBe('gone')
  })
})

describe('toggleHeading', () => {
  it('prefixes a plain line with the heading marker', () => {
    const view = makeView('Title', 0)
    toggleHeading(view as any, 1)
    expect(view.doc()).toBe('# Title')
    expect(view.sel()).toEqual({ anchor: 2, head: 2 })
  })

  it('removes the marker when the line already has the same level (toggle off)', () => {
    const view = makeView('## Title', 5)
    toggleHeading(view as any, 2)
    expect(view.doc()).toBe('Title')
    expect(view.sel()).toEqual({ anchor: 2, head: 2 })
  })

  it('replaces an existing heading prefix with the new level', () => {
    const view = makeView('# Title', 3)
    toggleHeading(view as any, 2)
    expect(view.doc()).toBe('## Title')
    expect(view.sel()).toEqual({ anchor: 4, head: 4 })
  })

  it('downgrades a deeper heading to a shallower one', () => {
    const view = makeView('### Title', 5)
    toggleHeading(view as any, 1)
    expect(view.doc()).toBe('# Title')
  })

  it('applies to every line of a multi-line selection', () => {
    const doc = 'one\ntwo\nthree'
    const view = makeView(doc, 0, doc.length)
    toggleHeading(view as any, 2)
    expect(view.doc()).toBe('## one\n## two\n## three')
  })

  it('clamps the selection start to the line start when toggling off near the marker', () => {
    const view = makeView('# Title', 1) // cursor inside the "# " marker
    toggleHeading(view as any, 1)
    expect(view.doc()).toBe('Title')
    expect(view.sel().anchor).toBe(0)
  })
})

describe('toggleBulletList', () => {
  it('adds a bullet to the current line', () => {
    const view = makeView('item', 2)
    toggleBulletList(view as any)
    expect(view.doc()).toBe('- item')
    expect(view.sel()).toEqual({ anchor: 4, head: 4 })
  })

  it('removes the bullet when already present', () => {
    const view = makeView('- item', 4)
    toggleBulletList(view as any)
    expect(view.doc()).toBe('item')
  })

  it('toggles each line of a multi-line selection independently', () => {
    const doc = '- a\nb'
    const view = makeView(doc, 0, doc.length)
    toggleBulletList(view as any)
    expect(view.doc()).toBe('a\n- b')
  })
})

describe('toggleNumberedList', () => {
  it('adds a "1. " prefix to every selected line', () => {
    const doc = 'a\nb'
    const view = makeView(doc, 0, doc.length)
    toggleNumberedList(view as any)
    expect(view.doc()).toBe('1. a\n1. b')
  })

  it('removes the prefix when already present', () => {
    const view = makeView('1. a', 3)
    toggleNumberedList(view as any)
    expect(view.doc()).toBe('a')
  })
})

describe('toggleCheckbox', () => {
  it('adds an unchecked checkbox prefix', () => {
    const view = makeView('task', 0)
    toggleCheckbox(view as any)
    expect(view.doc()).toBe('- [ ] task')
  })

  it('removes the checkbox prefix when present', () => {
    const view = makeView('- [ ] task', 8)
    toggleCheckbox(view as any)
    expect(view.doc()).toBe('task')
  })
})

describe('toggleBlockquote', () => {
  it('adds a "> " prefix', () => {
    const view = makeView('quote', 0)
    toggleBlockquote(view as any)
    expect(view.doc()).toBe('> quote')
  })

  it('removes the prefix when present', () => {
    const view = makeView('> quote', 4)
    toggleBlockquote(view as any)
    expect(view.doc()).toBe('quote')
  })
})

describe('insertLink', () => {
  it('wraps the selection as link text and places the url placeholder', () => {
    const view = makeView('see docs here', 4, 8)
    insertLink(view as any)
    expect(view.doc()).toBe('see [docs](url) here')
    // Link text stays selected so the user can keep editing it
    expect(view.sel()).toEqual({ anchor: 5, head: 9 })
  })

  it('inserts empty link syntax at an empty selection with cursor between brackets', () => {
    const view = makeView('', 0)
    insertLink(view as any)
    expect(view.doc()).toBe('[](url)')
    expect(view.sel()).toEqual({ anchor: 1, head: 1 })
  })
})

describe('insertImage', () => {
  it('inserts the image template with the alt placeholder selected', () => {
    const view = makeView('x ', 2)
    insertImage(view as any)
    expect(view.doc()).toBe('x ![alt](url)')
    expect(view.sel()).toEqual({ anchor: 4, head: 7 })
    expect(view.doc().slice(4, 7)).toBe('alt')
  })
})

describe('insertCitation', () => {
  it('inserts [@] with the cursor between @ and ]', () => {
    const view = makeView('see ', 4)
    insertCitation(view as any)
    expect(view.doc()).toBe('see [@]')
    expect(view.sel()).toEqual({ anchor: 6, head: 6 })
  })
})

describe('insertHorizontalRule', () => {
  it('inserts a rule on its own line and moves the cursor past it', () => {
    const view = makeView('above', 5)
    insertHorizontalRule(view as any)
    expect(view.doc()).toBe('above\n---\n')
    expect(view.sel()).toEqual({ anchor: 10, head: 10 })
  })
})

describe('detectActiveFormats', () => {
  it('detects bold at the cursor', () => {
    const doc = 'a **bold** b'
    expect(detectActiveFormats(makeState(doc, doc.indexOf('old')))).toContain('bold')
  })

  it('detects italic at the cursor', () => {
    const doc = 'a *it* b'
    expect(detectActiveFormats(makeState(doc, 4))).toContain('italic')
  })

  it('detects inline code at the cursor', () => {
    const doc = 'a `code` b'
    expect(detectActiveFormats(makeState(doc, 5))).toContain('code')
  })

  it('detects strikethrough at the cursor', () => {
    const doc = 'a ~~gone~~ b'
    expect(detectActiveFormats(makeState(doc, 5))).toContain('strikethrough')
  })

  it('reports nested formats (bold inside italic)', () => {
    const doc = '*a **b** c*'
    const formats = detectActiveFormats(makeState(doc, doc.indexOf('b') + 1))
    expect(formats).toContain('bold')
    expect(formats).toContain('italic')
  })

  it('reports no inline formats in plain text', () => {
    expect(detectActiveFormats(makeState('plain text', 3))).toEqual([])
  })

  it('detects heading levels 1-3 from the line prefix', () => {
    expect(detectActiveFormats(makeState('# h', 3))).toContain('heading-1')
    expect(detectActiveFormats(makeState('## h', 4))).toContain('heading-2')
    expect(detectActiveFormats(makeState('### h', 5))).toContain('heading-3')
  })

  it('detects bullet and numbered lists and blockquotes', () => {
    expect(detectActiveFormats(makeState('- item', 3))).toContain('bullet-list')
    expect(detectActiveFormats(makeState('* item', 3))).toContain('bullet-list')
    expect(detectActiveFormats(makeState('1. item', 3))).toContain('numbered-list')
    expect(detectActiveFormats(makeState('> quote', 3))).toContain('blockquote')
  })

  it('detects checkboxes as both bullet-list and checkbox', () => {
    const formats = detectActiveFormats(makeState('- [ ] task', 8))
    expect(formats).toContain('bullet-list')
    expect(formats).toContain('checkbox')
  })

  it('uses the line of the selection head for line-level formats', () => {
    const doc = '# heading\nplain'
    const formats = detectActiveFormats(makeState(doc, doc.length))
    expect(formats).not.toContain('heading-1')
  })
})
