import { describe, expect, it } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { computeSendSelection, languageFromPath, computeChunkSend } from './sendToTerminal.js'
import { markdownLanguageExtension } from './language.js'

describe('computeSendSelection', () => {
  it('single line doc with cursor at start returns full line text and nextPos=doc.length', () => {
    const state = EditorState.create({ doc: 'print(1)' })
    const result = computeSendSelection(state)
    expect(result).toEqual({ text: 'print(1)', nextPos: 8 })
  })

  it('multi-line doc with cursor on line 1 returns line text and nextPos at start of next line', () => {
    const state = EditorState.create({ doc: 'a\nb\nc' })
    const result = computeSendSelection(state)
    expect(result).toEqual({ text: 'a', nextPos: 2 })
  })

  it('cursor on a blank line returns null', () => {
    // doc: "a\n\nc" — cursor at pos 2 (the blank line)
    const state = EditorState.create({
      doc: 'a\n\nc',
      selection: EditorSelection.single(2),
    })
    const result = computeSendSelection(state)
    expect(result).toBeNull()
  })

  it('cursor on line 1 skips blank lines to find next non-blank line', () => {
    // doc: "a\n\n\nc" — cursor at pos 0
    const state = EditorState.create({ doc: 'a\n\n\nc' })
    const result = computeSendSelection(state)
    expect(result).toEqual({ text: 'a', nextPos: 4 })
  })

  it('non-empty selection returns selected text and nextPos=selection.to', () => {
    const state = EditorState.create({
      doc: 'abcdef',
      selection: EditorSelection.single(0, 3),
    })
    const result = computeSendSelection(state)
    expect(result).toEqual({ text: 'abc', nextPos: 3 })
  })

  it('cursor on the last line returns text and nextPos=doc.length', () => {
    // doc: "a\nb" — cursor at pos 2 (start of "b")
    const state = EditorState.create({
      doc: 'a\nb',
      selection: EditorSelection.single(2),
    })
    const result = computeSendSelection(state)
    expect(result).toEqual({ text: 'b', nextPos: 3 })
  })
})

describe('languageFromPath', () => {
  it('returns "r" for .R extension', () => {
    expect(languageFromPath('script.R')).toBe('r')
  })

  it('returns "r" for .r extension', () => {
    expect(languageFromPath('analysis.r')).toBe('r')
  })

  it('returns "python" for .py extension', () => {
    expect(languageFromPath('main.py')).toBe('python')
  })

  it('returns null for unrecognized extensions', () => {
    expect(languageFromPath('foo.ts')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(languageFromPath('')).toBeNull()
  })
})

describe('computeChunkSend', () => {
  function mdState(doc: string, cursorPos?: number) {
    return EditorState.create({
      doc,
      selection: cursorPos != null ? EditorSelection.single(cursorPos) : undefined,
      extensions: [markdownLanguageExtension()],
    })
  }

  const rChunk = '```{r}\nx <- 1\ny <- 2\n```'
  // positions: ```{r}\n = 7, x <- 1\n = 13 (pos 7-12), y <- 2\n = 19 (pos 14-18), ``` = 20-22

  it('sends current line in line mode when cursor is mid-chunk', () => {
    const state = mdState(rChunk, 7) // start of "x <- 1"
    const result = computeChunkSend(state, 'line')
    expect(result).not.toBeNull()
    expect(result!.text).toBe('x <- 1')
    expect(result!.language).toBe('r')
  })

  it('sends whole chunk body in chunk mode', () => {
    const state = mdState(rChunk, 7) // cursor in chunk
    const result = computeChunkSend(state, 'chunk')
    expect(result).not.toBeNull()
    expect(result!.text).toBe('x <- 1\ny <- 2')
    expect(result!.language).toBe('r')
  })

  it('returns null for cursor on the opening fence line in line mode', () => {
    const state = mdState(rChunk, 0) // on the ``` line
    const result = computeChunkSend(state, 'line')
    expect(result).toBeNull()
  })

  it('returns null outside any chunk', () => {
    const doc = 'Some prose\n\n' + rChunk
    const state = mdState(doc, 0) // in prose
    const result = computeChunkSend(state, 'line')
    expect(result).toBeNull()
  })

  it('returns null for unterminated chunk at EOF', () => {
    const doc = '```{r}\nx <- 1'
    const state = mdState(doc, 7)
    const result = computeChunkSend(state, 'line')
    expect(result).toBeNull()
  })

  it('detects python chunks', () => {
    const doc = '```{python}\nprint(1)\n```'
    const state = mdState(doc, 12) // on "print(1)"
    const result = computeChunkSend(state, 'line')
    expect(result).not.toBeNull()
    expect(result!.language).toBe('python')
    expect(result!.text).toBe('print(1)')
  })

  it('handles Quarto-style chunk headers with options', () => {
    const doc = '```{r, echo=FALSE}\nx <- 1\n```'
    const state = mdState(doc, 19) // on "x <- 1"
    const result = computeChunkSend(state, 'line')
    expect(result).not.toBeNull()
    expect(result!.language).toBe('r')
    expect(result!.text).toBe('x <- 1')
  })

  it('returns null for blank lines within chunk in line mode', () => {
    const doc = '```{r}\nx <- 1\n\ny <- 2\n```'
    // ```{r}\n = 7, x <- 1\n = 14, \n (blank) = 14, y <- 2\n = 21
    // blank line is at position 14 (the empty line between x and y)
    const state = mdState(doc, 14) // the blank line
    const result = computeChunkSend(state, 'line')
    expect(result).toBeNull()
  })

  it('sends selection within chunk in line mode', () => {
    const doc = '```{r}\nx <- 1\ny <- 2\n```'
    // ```{r}\n = 7, x <- 1\n = pos 7-13, y <- 2\n = pos 14-19
    // Select "x <- 1\ny <- 2" (positions 7 to 20)
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(7, 20),
      extensions: [markdownLanguageExtension()],
    })
    const result = computeChunkSend(state, 'line')
    expect(result).not.toBeNull()
    expect(result!.text).toBe('x <- 1\ny <- 2')
    expect(result!.language).toBe('r')
  })
})
