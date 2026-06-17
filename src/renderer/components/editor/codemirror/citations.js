import { Prec } from '@codemirror/state'
import { acceptCompletion, autocompletion, completionStatus, startCompletion } from '@codemirror/autocomplete'
import { EditorView, Decoration, ViewPlugin, hoverTooltip, keymap } from '@codemirror/view'

export function citationExtensions(getReferences, getDiagnostics, actions = {}) {
  return [
    autocompletion({
      override: [citationCompletionSource(getReferences, actions)],
      activateOnTyping: true,
      defaultKeymap: true,
    }),
    citationCompletionKeymap(),
    citationCompletionTrigger(getReferences),
    citationDecorations(getReferences, getDiagnostics),
    citationHover(getReferences, getDiagnostics, actions),
  ]
}

function citationCompletionKeymap() {
  return Prec.highest(keymap.of([
    {
      key: 'Enter',
      run(view) {
        if (completionStatus(view.state) !== 'active') return false
        return acceptCompletion(view)
      },
    },
    {
      key: 'Tab',
      run(view) {
        if (completionStatus(view.state) !== 'active') return false
        return acceptCompletion(view)
      },
    },
  ]))
}

function citationCompletionTrigger(getReferences) {
  return Prec.highest(EditorView.domEventHandlers({
    keydown(event, view) {
      if ((event.key === 'Enter' || event.key === 'Tab') && applyVisibleCitationCompletion(view, getReferences)) {
        event.preventDefault()
        return true
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return false
      if (!/^[\w@:\[\]./-]$/.test(event.key)) return false
      requestAnimationFrame(() => maybeStartCitationCompletion(view))
      return false
    },
  }))
}

function maybeStartCitationCompletion(view) {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const beforeCursor = line.text.slice(0, head - line.from)
  if (/@[\w:./-]*$/.test(beforeCursor) || /\[@[\w:./-]*$/.test(beforeCursor)) {
    startCompletion(view)
  }
}

export function applyVisibleCitationCompletion(view, getReferences) {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const beforeCursor = line.text.slice(0, head - line.from)
  const match = beforeCursor.match(/(\[@|@)([\w:-]*)$/)
  if (!match) return false
  const [, trigger, query] = match
  if (!query) return false
  const ref = getReferences().find((item) => referenceHaystack(item).includes(query.toLowerCase()))
  if (!ref) return false
  const insert = trigger === '[@' ? `${ref.key}]` : ref.key
  const from = head - query.length
  view.dispatch({
    changes: { from, to: head, insert },
    selection: { anchor: from + insert.length },
  })
  return true
}

function referenceHaystack(ref) {
  return [
    ref.key,
    ref.author,
    ref.year,
    ref.title,
    ref.venue,
    ref.journal,
    ref.booktitle,
    ref.doi,
    ref.source,
    ref.url,
    ref.type,
    ...Object.values(ref.fields || {}),
  ].filter(Boolean).join(' ').toLowerCase()
}

export function citationCompletionSource(getReferences, actions = {}) {
  return (context) => {
    const before = context.matchBefore(/@[\w:./-]*$/)
    const bracketed = context.matchBefore(/\[@[\w:./-]*$/)
    // Prefer the bracketed match: any "[@..." tail also matches the bare "@"
    // pattern, and only the bracketed branch appends the closing "]" on apply.
    const match = bracketed || before
    if (!match || (match.from === match.to && !context.explicit)) return null

    const query = match.text.replace(/^\[/, '').replace(/^@/, '').toLowerCase()
    const bracketedCitation = match.text.startsWith('[@')
    const refs = getReferences()
    const options = refs
      .filter((ref) => {
        return !query || referenceHaystack(ref).includes(query)
      })
      .slice(0, 40)
      .map((ref) => ({
        label: ref.key,
        type: 'reference',
        displayLabel: `@${ref.key}`,
        // Title is what authors recognize; show it in the row, push the
        // author/year/venue context into the side info panel.
        detail: truncate(ref.title, 56),
        info: [ref.author, ref.year, ref.source].filter(Boolean).join(' · '),
        apply(view, completion, from, to) {
          const insert = bracketedCitation ? `${completion.label}]` : completion.label
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          })
        },
      }))
    const addOption = addCitationOption(query, bracketedCitation, actions)
    if (addOption) options.unshift(addOption)
    if (options.length === 0) return null

    // No `validFor`: within validFor CodeMirror stops re-querying this source
    // and re-filters the existing options against the bibkey label only, which
    // silently drops author/title matches as the user keeps typing. Omitting it
    // re-runs the rich haystack filter on every keystroke (libraries are small
    // and in-memory, so this is cheap) and keeps author/title search live.
    return {
      from: bracketedCitation ? match.from + 2 : match.from + 1,
      options,
      filter: false,
    }
  }
}

function addCitationOption(query, bracketedCitation, actions) {
  if (!actions || typeof actions.addCitation !== 'function') return null
  if (typeof actions.canAddCitation === 'function' && !actions.canAddCitation()) return null
  if (!looksLikeDoi(query)) return null
  return {
    label: 'Add & cite',
    type: 'reference',
    displayLabel: 'Add & cite',
    detail: query,
    info: 'Resolve DOI into the project library',
    apply(view, completion, from, to) {
      Promise.resolve(actions.addCitation(query))
        .then((result) => {
          const key = typeof result === 'string' ? result : result?.key
          if (!key) return
          const insert = bracketedCitation ? `${key}]` : key
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length },
          })
          actions.onReferencesChanged?.(key)
        })
        .catch((err) => actions.onError?.(err))
    },
  }
}

function citationDecorations(getReferences, getDiagnostics) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.signature = citationSignature(getReferences, getDiagnostics)
        this.decorations = this.build(view)
      }

      update(update) {
        const signature = citationSignature(getReferences, getDiagnostics)
        if (update.docChanged || update.viewportChanged || signature !== this.signature) {
          this.signature = signature
          this.decorations = this.build(update.view)
        }
      }

      build(view) {
        if (!citationsEnabled(getDiagnostics)) return Decoration.none
        const refs = new Set(getReferences().map((ref) => ref.key))
        const diagnostics = getDiagnostics()
        const duplicateKeys = new Set((diagnostics.duplicateKeys || []).map((item) => item.key))
        const decorations = []
        const { from, to } = view.viewport
        const start = Math.max(0, from - 300)
        const end = Math.min(view.state.doc.length, to + 300)
        const text = view.state.doc.sliceString(start, end)
        const re = /(^|[^\w])@([a-zA-Z][\w:-]*)/g
        let match

        while ((match = re.exec(text)) !== null) {
          const key = match[2]
          const fromPos = start + match.index + match[1].length
          const toPos = fromPos + key.length + 1
          let cls = 'cm-citation'
          if (!refs.has(key)) cls = 'cm-citation cm-citation-missing'
          else if (duplicateKeys.has(key)) cls = 'cm-citation cm-citation-duplicate'
          decorations.push(Decoration.mark({ class: cls }).range(fromPos, toPos))
        }

        return Decoration.set(decorations.sort((a, b) => a.from - b.from))
      }
    },
    { decorations: (v) => v.decorations }
  )
}

function citationHover(getReferences, getDiagnostics, actions = {}) {
  return hoverTooltip((view, pos) => {
    if (!citationsEnabled(getDiagnostics)) return null
    const line = view.state.doc.lineAt(pos)
    const re = /(^|[^\w])@([a-zA-Z][\w:-]*)/g
    let match

    while ((match = re.exec(line.text)) !== null) {
      const key = match[2]
      const from = line.from + match.index + match[1].length
      const to = from + key.length + 1
      if (pos < from || pos > to) continue
      const ref = getReferences().find((item) => item.key === key)
      return {
        pos: from,
        end: to,
        create() {
          const dom = document.createElement('div')
          dom.className = 'citation-tooltip'
          if (!ref) {
            dom.innerHTML = `<strong>Missing reference</strong><span>@${escapeHtml(key)}</span>`
          } else {
            dom.innerHTML = `<strong>${escapeHtml(ref.title)}</strong><span>${escapeHtml(ref.author)} · ${escapeHtml(ref.year)}</span><small>${escapeHtml(ref.source || '')}</small>`
            const pdfPath = citationPdfPath(ref)
            if (pdfPath && typeof actions.openPdf === 'function') {
              const button = document.createElement('button')
              button.type = 'button'
              button.className = 'citation-tooltip-action'
              button.textContent = 'Open PDF'
              button.addEventListener('click', (event) => {
                event.preventDefault()
                event.stopPropagation()
                actions.openPdf(ref, pdfPath)
              })
              dom.appendChild(button)
            }
          }
          return { dom }
        },
      }
    }
    return null
  })
}

function citationsEnabled(getDiagnostics) {
  return getDiagnostics()?.enabled !== false
}

function citationSignature(getReferences, getDiagnostics) {
  if (!citationsEnabled(getDiagnostics)) return 'disabled'
  const duplicateKeys = (getDiagnostics()?.duplicateKeys || []).map((item) => item.key).join('\0')
  const referenceKeys = getReferences().map((ref) => ref.key).join('\0')
  return `${referenceKeys}\n${duplicateKeys}`
}

function truncate(value, max) {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function looksLikeDoi(value) {
  return /\b10\.\d{4,9}\//i.test(String(value || ''))
}

export function citationPdfPath(ref) {
  const raw = String(ref?.file || ref?.fields?.file || '')
  if (!raw) return ''
  const match = raw.match(/(?:^|[:;])([^:;{}]+\.pdf)(?:[:;]|$)/i) || raw.match(/([^:;{}]+\.pdf)/i)
  if (!match) return ''
  const matched = match[1].trim()
  if (!matched || matched.startsWith('/') || matched.startsWith('..') || /^[A-Za-z]:/.test(matched)) return ''
  const path = matched.replace(/^\/+/, '')
  return path
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
