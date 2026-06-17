/* @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import {
  applyVisibleCitationCompletion,
  citationCompletionSource,
  citationExtensions,
  citationPdfPath,
} from './citations.js'

const REFS = [
  { key: 'smith2020', author: 'Smith, J.', year: '2020', title: 'A Study of Things', source: 'refs.bib' },
  { key: 'doe2021', author: 'Doe, A.', year: '2021', title: 'Tolstoy and Modernity', journal: 'Lit Review' },
  { key: 'lee2019', author: 'Lee, K.', year: '2019', title: 'Quantum Widgets', doi: '10.1000/xyz' },
  { key: 'film1968', author: 'Kubrick, Stanley', year: '1968', title: '2001: A Space Odyssey', fields: { director: 'Kubrick, Stanley', medium: 'film' } },
]
const getRefs = () => REFS

/** Minimal fake view: the citation helpers only use state + dispatch. */
function makeView(doc: string, head = doc.length) {
  let state = EditorState.create({ doc, selection: { anchor: head } })
  return {
    get state() {
      return state
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state
    },
    doc() {
      return state.doc.toString()
    },
  }
}

function complete(doc: string, pos = doc.length, explicit = false) {
  const state = EditorState.create({ doc, selection: { anchor: pos } })
  const context = new CompletionContext(state, pos, explicit)
  return citationCompletionSource(getRefs)(context)
}

function applyOption(doc: string, option: Completion & { apply: Function }, from: number, to: number) {
  const view = makeView(doc, to)
  option.apply(view, option, from, to)
  return view
}

describe('citationCompletionSource', () => {
  it('returns null when there is no @ token before the cursor', () => {
    expect(complete('plain text')).toBeNull()
    expect(complete('mail@')).not.toBeNull() // bare @ does match
    expect(complete('no at here', 5)).toBeNull()
  })

  it('completes after a bare @ with options for all references', () => {
    const result = complete('see @')
    expect(result).not.toBeNull()
    expect(result!.from).toBe(5) // right after the @
    expect(result!.options.map((o: Completion) => o.label)).toEqual(['smith2020', 'doe2021', 'lee2019', 'film1968'])
  })

  it('does not offer citation completions without loaded references', () => {
    const state = EditorState.create({ doc: 'see @', selection: { anchor: 5 } })
    const context = new CompletionContext(state, 5, false)
    expect(citationCompletionSource(() => [])(context)).toBeNull()
  })

  it('offers Add & cite for DOI queries when the references app action is available', async () => {
    const addCitation = vi.fn().mockResolvedValue({ key: 'smith2024' })
    const onReferencesChanged = vi.fn()
    const state = EditorState.create({ doc: 'see [@10.1000/example', selection: { anchor: 'see [@10.1000/example'.length } })
    const context = new CompletionContext(state, 'see [@10.1000/example'.length, false)
    const result = citationCompletionSource(() => [], { addCitation, onReferencesChanged })(context)!
    const option = result.options[0] as Completion & { apply: Function }
    const view = makeView('see [@10.1000/example')

    option.apply(view, option, result.from, 'see [@10.1000/example'.length)
    await addCitation.mock.results[0].value
    await Promise.resolve()

    expect(addCitation).toHaveBeenCalledWith('10.1000/example')
    expect(view.doc()).toBe('see [@smith2024]')
    expect(onReferencesChanged).toHaveBeenCalledWith('smith2024')
  })

  it('hides Add & cite when the references app action is unavailable', () => {
    const addCitation = vi.fn()
    const doc = 'see @10.1000/example'
    const state = EditorState.create({ doc, selection: { anchor: doc.length } })
    const context = new CompletionContext(state, doc.length, false)

    expect(citationCompletionSource(() => [], { addCitation, canAddCitation: () => false })(context)).toBeNull()
  })

  it('filters options by key substring', () => {
    const result = complete('see @smi')
    expect(result!.options.map((o: Completion) => o.label)).toEqual(['smith2020'])
  })

  it('filters case-insensitively across author, title, journal and doi', () => {
    expect(complete('@Tolstoy')!.options.map((o: Completion) => o.label)).toEqual(['doe2021'])
    expect(complete('@LIT')!.options.map((o: Completion) => o.label)).toEqual(['doe2021'])
    expect(complete('@10')!.options.map((o: Completion) => o.label)).toEqual(['lee2019'])
    expect(complete('@film')!.options.map((o: Completion) => o.label)).toEqual(['film1968'])
  })

  it('exposes display metadata on each option', () => {
    const option = complete('@smith')!.options[0] as Completion
    expect(option.displayLabel).toBe('@smith2020')
    // Title is shown in the row (detail); author/year/venue move to the side
    // info panel so the recognizable text is what the user scans.
    expect(option.detail).toBe('A Study of Things')
    expect(option.info).toBe('Smith, J. · 2020 · refs.bib')
    expect(option.type).toBe('reference')
  })

  it('caps the option list at 40 entries', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      key: `ref${i}`,
      author: 'A',
      year: '2000',
      title: 'T',
    }))
    const state = EditorState.create({ doc: '@', selection: { anchor: 1 } })
    const result = citationCompletionSource(() => many)(new CompletionContext(state, 1, false))
    expect(result!.options).toHaveLength(40)
  })

  it('applies a bare-@ completion by replacing the typed query with the key', () => {
    const doc = 'see @smi'
    const result = complete(doc)!
    const view = applyOption(doc, result.options[0] as any, result.from, doc.length)
    expect(view.doc()).toBe('see @smith2020')
    expect(view.state.selection.main.anchor).toBe('see @smith2020'.length)
  })

  it('completes inside [@...] and appends the closing bracket', () => {
    const doc = 'see [@smi'
    const result = complete(doc)!
    expect(result.from).toBe(6) // right after "[@"
    expect(result.options.map((o: Completion) => o.label)).toEqual(['smith2020'])
    const view = applyOption(doc, result.options[0] as any, result.from, doc.length)
    expect(view.doc()).toBe('see [@smith2020]')
  })
})

describe('citationPdfPath', () => {
  it('extracts safe workspace PDF paths from BibTeX file fields', () => {
    expect(citationPdfPath({ fields: { file: 'pdf/smith2024.pdf' } })).toBe('pdf/smith2024.pdf')
    expect(citationPdfPath({ file: ':references/pdf/smith2024.pdf:PDF' })).toBe('references/pdf/smith2024.pdf')
  })

  it('rejects outside or non-PDF file fields', () => {
    expect(citationPdfPath({ fields: { file: '../secret.pdf' } })).toBe('')
    expect(citationPdfPath({ fields: { file: '/tmp/secret.pdf' } })).toBe('')
    expect(citationPdfPath({ fields: { file: 'notes.txt' } })).toBe('')
  })
})

describe('applyVisibleCitationCompletion', () => {
  it('replaces a bare-@ query with the first matching reference key', () => {
    const view = makeView('see @smi')
    expect(applyVisibleCitationCompletion(view, getRefs)).toBe(true)
    expect(view.doc()).toBe('see @smith2020')
    expect(view.state.selection.main.anchor).toBe('see @smith2020'.length)
  })

  it('closes the bracket for [@ citations', () => {
    const view = makeView('see [@smi')
    expect(applyVisibleCitationCompletion(view, getRefs)).toBe(true)
    expect(view.doc()).toBe('see [@smith2020]')
  })

  it('matches against the full reference haystack, case-insensitively', () => {
    const view = makeView('see [@TOLSTOY')
    expect(applyVisibleCitationCompletion(view, getRefs)).toBe(true)
    expect(view.doc()).toBe('see [@doe2021]')
  })

  it('returns false and leaves the doc unchanged when the query is empty', () => {
    const view = makeView('see @')
    expect(applyVisibleCitationCompletion(view, getRefs)).toBe(false)
    expect(view.doc()).toBe('see @')
  })

  it('returns false when no reference matches', () => {
    const view = makeView('see @zzzz')
    expect(applyVisibleCitationCompletion(view, getRefs)).toBe(false)
    expect(view.doc()).toBe('see @zzzz')
  })

  it('returns false when there is no citation token before the cursor', () => {
    const view = makeView('plain text')
    expect(applyVisibleCitationCompletion(view, getRefs)).toBe(false)
  })
})

describe('citation decorations (via citationExtensions in a real view)', () => {
  function renderView(doc: string, diagnostics: Record<string, unknown> = {}) {
    const state = EditorState.create({
      doc,
      extensions: [citationExtensions(getRefs, () => diagnostics)],
    })
    return new EditorView({ state, parent: document.createElement('div') })
  }

  function citationSpans(view: EditorView) {
    return Array.from(view.contentDOM.querySelectorAll('.cm-citation')).map((el) => ({
      text: el.textContent,
      missing: el.classList.contains('cm-citation-missing'),
      duplicate: el.classList.contains('cm-citation-duplicate'),
    }))
  }

  it('marks known keys as citations and unknown keys as missing', () => {
    const view = renderView('see @smith2020 and @unknown99')
    expect(citationSpans(view)).toEqual([
      { text: '@smith2020', missing: false, duplicate: false },
      { text: '@unknown99', missing: true, duplicate: false },
    ])
    view.destroy()
  })

  it('marks keys reported in duplicateKeys diagnostics', () => {
    const view = renderView('cite @doe2021 here', { duplicateKeys: [{ key: 'doe2021' }] })
    expect(citationSpans(view)).toEqual([
      { text: '@doe2021', missing: false, duplicate: true },
    ])
    view.destroy()
  })

  it('ignores @ tokens that do not start with a letter', () => {
    const view = renderView('price @1234 only')
    expect(citationSpans(view)).toEqual([])
    view.destroy()
  })

  it('ignores email addresses when decorating citations', () => {
    const view = renderView('mail me at person@example.com and cite @smith2020')
    expect(citationSpans(view)).toEqual([
      { text: '@smith2020', missing: false, duplicate: false },
    ])
    view.destroy()
  })

  it('updates decorations when the document changes', () => {
    const view = renderView('start ')
    expect(citationSpans(view)).toEqual([])
    view.dispatch({ changes: { from: view.state.doc.length, insert: '@lee2019' } })
    expect(citationSpans(view)).toEqual([
      { text: '@lee2019', missing: false, duplicate: false },
    ])
    view.destroy()
  })

  it('stays dormant when citation diagnostics are disabled', () => {
    const view = renderView('see @smith2020 and @unknown99', { enabled: false })
    expect(citationSpans(view)).toEqual([])
    view.destroy()
  })

  it('updates decorations when the reference list changes without document edits', () => {
    let refs: typeof REFS | [] = []
    const view = new EditorView({
      state: EditorState.create({
        doc: 'see @smith2020',
        extensions: [citationExtensions(() => refs, () => ({ enabled: true }))],
      }),
      parent: document.createElement('div'),
    })

    expect(citationSpans(view)).toEqual([
      { text: '@smith2020', missing: true, duplicate: false },
    ])

    refs = REFS
    view.dispatch({})

    expect(citationSpans(view)).toEqual([
      { text: '@smith2020', missing: false, duplicate: false },
    ])
    view.destroy()
  })
})
