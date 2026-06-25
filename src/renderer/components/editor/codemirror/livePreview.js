import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { RangeSet, StateField, Prec } from '@codemirror/state'

export function parseMarkdownTable(text) {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return null

  const splitRow = (line) => {
    let trimmed = line.trim()
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
    const cells = []
    let current = ''
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '\\' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
        current += '|'
        i++
      } else if (trimmed[i] === '|') {
        cells.push(current.trim())
        current = ''
      } else {
        current += trimmed[i]
      }
    }
    cells.push(current.trim())
    return cells
  }

  const headerCells = splitRow(lines[0])
  const delimCells = splitRow(lines[1])

  const isDelimiter = delimCells.every(c => /^:?-+:?$/.test(c.trim()))
  if (!isDelimiter) return null

  const alignments = delimCells.map(cell => {
    const d = cell.trim()
    const left = d.startsWith(':')
    const right = d.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })

  const rows = []
  for (let i = 2; i < lines.length; i++) {
    rows.push(splitRow(lines[i]))
  }

  return { headers: headerCells, alignments, rows }
}

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('hr')
    el.className = 'cm-lp-hr'
    return el
  }
  eq() { return true }
  ignoreEvent() { return false }
}

class TableWidget extends WidgetType {
  constructor(text, from) {
    super()
    this.text = text
    this.from = from
  }

  eq(other) { return this.text === other.text && this.from === other.from }
  ignoreEvent() { return false }

  toDOM() {
    const parsed = parseMarkdownTable(this.text)
    if (!parsed) {
      const pre = document.createElement('pre')
      pre.textContent = this.text
      pre.className = 'cm-lp-table-fallback'
      return pre
    }

    const table = document.createElement('table')
    table.className = 'cm-lp-table'

    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    parsed.headers.forEach((cell, i) => {
      const th = document.createElement('th')
      th.textContent = cell
      const align = parsed.alignments[i] || 'left'
      if (align !== 'left') th.style.textAlign = align
      headerRow.appendChild(th)
    })
    thead.appendChild(headerRow)
    table.appendChild(thead)

    if (parsed.rows.length > 0) {
      const tbody = document.createElement('tbody')
      parsed.rows.forEach(row => {
        const tr = document.createElement('tr')
        for (let i = 0; i < parsed.headers.length; i++) {
          const td = document.createElement('td')
          td.textContent = row[i] || ''
          const align = parsed.alignments[i] || 'left'
          if (align !== 'left') td.style.textAlign = align
          tr.appendChild(td)
        }
        tbody.appendChild(tr)
      })
      table.appendChild(tbody)
    }

    const wrapper = document.createElement('div')
    wrapper.className = 'cm-lp-table-wrap'
    wrapper.dataset.mimTableFrom = String(this.from)
    wrapper.title = 'Click to edit table source'
    wrapper.appendChild(table)
    return wrapper
  }
}

export class ImageWidget extends WidgetType {
  constructor(src, imagePath) {
    super()
    this.src = src
    this.imagePath = imagePath
  }

  eq(other) { return this.imagePath === other.imagePath }
  ignoreEvent() { return false }

  toDOM() {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-lp-image-wrap'

    const img = document.createElement('img')

    if (isExternalImageSrc(this.imagePath)) {
      img.src = this.imagePath
      wrapper.appendChild(img)
    } else {
      img.src = TRANSPARENT_PIXEL
      img.dataset.mimImageSrc = this.imagePath
      img.onerror = () => {
        const placeholder = document.createElement('span')
        placeholder.className = 'cm-lp-image-placeholder'
        placeholder.textContent = 'Image not found'
        img.replaceWith(placeholder)
      }
      loadWorkspaceImageDataUrl(this.imagePath)
        .then(dataUrl => { img.src = dataUrl })
        .catch(() => {
          img.onerror?.(new Event('error'))
        })
      wrapper.appendChild(img)
    }

    return wrapper
  }
}

const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

function isExternalImageSrc(src) {
  return /^(https?:|data:|blob:)/i.test(src)
}

export async function loadWorkspaceImageDataUrl(path) {
  const kernel = typeof window !== 'undefined' ? window.kernel : null
  if (!kernel?.call) throw new Error('Kernel bridge unavailable')
  const result = await kernel.call('fs.readImageDataUrl', { path })
  if (!result || typeof result !== 'object' || typeof result.dataUrl !== 'string') {
    throw new Error(`Image read did not return a data URL: ${path}`)
  }
  return result.dataUrl
}

export function resolveImagePath(src, filePath) {
  if (isExternalImageSrc(src)) return src
  let decoded = src
  try {
    decoded = decodeURIComponent(src)
  } catch {
    // Keep the original string; the main-process path resolver will reject
    // invalid paths instead of letting a preview escape the workspace.
  }
  if (decoded.startsWith('/')) return decoded.replace(/^\/+/, '')
  const slash = filePath.lastIndexOf('/')
  const dir = slash >= 0 ? filePath.substring(0, slash) : ''
  const combined = dir ? `${dir}/${decoded}` : decoded
  const parts = combined.split('/')
  const resolved = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else if (part !== '.') resolved.push(part)
  }
  return resolved.join('/')
}

export function buildDecorations(view, isEnabled, getFilePath) {
  if (!isEnabled()) return Decoration.none

  const { state } = view

  const cursorLines = new Set()
  for (const range of state.selection.ranges) {
    const headLine = state.doc.lineAt(range.head).number
    const anchorLine = state.doc.lineAt(range.anchor).number
    for (let l = Math.min(headLine, anchorLine); l <= Math.max(headLine, anchorLine); l++) {
      cursorLines.add(l)
    }
  }

  const { from: vpFrom, to: vpTo } = view.viewport
  const start = Math.max(0, vpFrom - 500)
  const end = Math.min(state.doc.length, vpTo + 500)

  const decos = []

  syntaxTree(state).iterate({
    from: start,
    to: end,
    enter(node) {
      const name = node.type.name
      const nFrom = node.from
      const nTo = node.to

      if (name === 'FencedCode') {
        const startLine = state.doc.lineAt(nFrom)
        const endLine = state.doc.lineAt(nTo > nFrom ? nTo - 1 : nTo)
        for (let l = startLine.number; l <= endLine.number; l++) {
          decos.push(Decoration.line({ class: 'cm-lp-code-block-line' }).range(state.doc.line(l).from))
        }
        if (!cursorLines.has(startLine.number)) {
          decos.push(Decoration.line({ class: 'cm-lp-fence-line' }).range(startLine.from))
        }
        if (endLine.number !== startLine.number && !cursorLines.has(endLine.number)) {
          decos.push(Decoration.line({ class: 'cm-lp-fence-line' }).range(endLine.from))
        }
        return false
      }
      if (name === 'CodeBlock') return false

      const nodeLine = state.doc.lineAt(nFrom).number
      const onCursorLine = cursorLines.has(nodeLine)

      if (name === 'StrongEmphasis' && !onCursorLine) {
        let marks = []
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.from < nFrom || child.to > nTo) return
            if (child.type.name === 'EmphasisMark') {
              marks.push({ from: child.from, to: child.to })
            }
          },
        })
        if (marks.length >= 2) {
          decos.push(Decoration.replace({}).range(marks[0].from, marks[0].to))
          decos.push(Decoration.replace({}).range(marks[marks.length - 1].from, marks[marks.length - 1].to))
          decos.push(Decoration.mark({ class: 'cm-lp-bold' }).range(marks[0].to, marks[marks.length - 1].from))
        }
        return false
      }

      if (name === 'Emphasis' && !onCursorLine) {
        let marks = []
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.from < nFrom || child.to > nTo) return
            if (child.type.name === 'EmphasisMark') {
              marks.push({ from: child.from, to: child.to })
            }
          },
        })
        if (marks.length >= 2) {
          decos.push(Decoration.replace({}).range(marks[0].from, marks[0].to))
          decos.push(Decoration.replace({}).range(marks[marks.length - 1].from, marks[marks.length - 1].to))
          decos.push(Decoration.mark({ class: 'cm-lp-italic' }).range(marks[0].to, marks[marks.length - 1].from))
        }
        return false
      }

      if (name === 'Strikethrough' && !onCursorLine) {
        let marks = []
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.from < nFrom || child.to > nTo) return
            if (child.type.name === 'StrikethroughMark') {
              marks.push({ from: child.from, to: child.to })
            }
          },
        })
        if (marks.length >= 2) {
          decos.push(Decoration.replace({}).range(marks[0].from, marks[0].to))
          decos.push(Decoration.replace({}).range(marks[marks.length - 1].from, marks[marks.length - 1].to))
          decos.push(Decoration.mark({ class: 'cm-lp-strike' }).range(marks[0].to, marks[marks.length - 1].from))
        }
        return false
      }

      if (name === 'InlineCode' && !onCursorLine) {
        let marks = []
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.from < nFrom || child.to > nTo) return
            if (child.type.name === 'CodeMark') {
              marks.push({ from: child.from, to: child.to })
            }
          },
        })
        if (marks.length >= 2) {
          decos.push(Decoration.replace({}).range(marks[0].from, marks[0].to))
          decos.push(Decoration.replace({}).range(marks[marks.length - 1].from, marks[marks.length - 1].to))
          decos.push(Decoration.mark({ class: 'cm-lp-inline-code' }).range(marks[0].to, marks[marks.length - 1].from))
        }
        return false
      }

      if (name === 'Link' && !onCursorLine) {
        let linkMarks = []
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.from < nFrom || child.to > nTo) return
            if (child.type.name === 'LinkMark') {
              linkMarks.push({ from: child.from, to: child.to })
            }
          },
        })
        if (linkMarks.length >= 1) {
          decos.push(Decoration.replace({}).range(linkMarks[0].from, linkMarks[0].to))
        }
        if (linkMarks.length >= 2) {
          decos.push(Decoration.replace({}).range(linkMarks[1].from, nTo))
          decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(linkMarks[0].to, linkMarks[1].from))
        }
        return false
      }

      if (name === 'Image' && !onCursorLine) {
        let imgUrl = null
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.from < nFrom || child.to > nTo) return
            if (child.type.name === 'URL') {
              imgUrl = state.sliceDoc(child.from, child.to)
            }
          },
        })
        if (imgUrl && getFilePath) {
          const imagePath = resolveImagePath(imgUrl, getFilePath())
          decos.push(Decoration.replace({ widget: new ImageWidget(imgUrl, imagePath) }).range(nFrom, nTo))
        }
        return false
      }

      if (name.startsWith('ATXHeading') && !onCursorLine) {
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.type.name === 'HeaderMark') {
              const hideEnd = Math.min(child.to + 1, nTo)
              decos.push(Decoration.replace({}).range(child.from, hideEnd))
            }
          },
        })
      }

      if (name === 'Blockquote' && !onCursorLine) {
        syntaxTree(state).iterate({
          from: nFrom, to: nTo,
          enter(child) {
            if (child.type.name === 'QuoteMark') {
              const hideEnd = Math.min(child.to + 1, nTo)
              decos.push(Decoration.replace({}).range(child.from, hideEnd))
            }
          },
        })
        const startLine = state.doc.lineAt(nFrom).number
        const endLine = state.doc.lineAt(Math.min(nTo, state.doc.length)).number
        for (let l = startLine; l <= endLine; l++) {
          const lineStart = state.doc.line(l).from
          decos.push(Decoration.line({ class: 'cm-lp-blockquote-line' }).range(lineStart))
        }
      }

      if (name === 'HorizontalRule' && !onCursorLine) {
        decos.push(Decoration.replace({ widget: new HrWidget() }).range(nFrom, nTo))
        return false
      }

      if (name === 'Table') return false
    },
  })

  // RangeSet.of(ranges, true) sorts with CodeMirror's full Range comparator
  // (from, startSide, to, endSide). The previous manual sort —
  // a.from - b.from || a.startSide - b.startSide — could not tie-break, so
  // decorations sharing (from, startSide) — e.g. a blockquote's replace
  // quote-mark and its line-class decoration at the same line start — stayed
  // in push order and RangeSetBuilder rejected them ("Ranges must be added
  // sorted by `from` position and `startSide`").
  return RangeSet.of(decos, true)
}

function buildTableDecorations(state, isEnabled) {
  if (!isEnabled()) return Decoration.none

  const cursorLines = new Set()
  for (const range of state.selection.ranges) {
    const headLine = state.doc.lineAt(range.head).number
    const anchorLine = state.doc.lineAt(range.anchor).number
    for (let l = Math.min(headLine, anchorLine); l <= Math.max(headLine, anchorLine); l++) {
      cursorLines.add(l)
    }
  }

  const decos = []

  syntaxTree(state).iterate({
    enter(node) {
      const name = node.type.name
      if (name === 'FencedCode' || name === 'CodeBlock') return false

      if (name === 'Table') {
        const fromLine = state.doc.lineAt(node.from)
        const toLine = state.doc.lineAt(node.to > node.from ? node.to - 1 : node.to)
        let cursorInTable = false
        for (let l = fromLine.number; l <= toLine.number; l++) {
          if (cursorLines.has(l)) { cursorInTable = true; break }
        }
        if (!cursorInTable) {
          const text = state.sliceDoc(node.from, node.to)
          decos.push(
            Decoration.replace({ widget: new TableWidget(text, fromLine.from), block: true })
              .range(fromLine.from, toLine.to)
          )
        }
        return false
      }
    },
  })

  return RangeSet.of(decos, true)
}

function navigateIntoTable(view, direction, isEnabled) {
  if (!isEnabled()) return false

  const { state } = view
  const pos = state.selection.main.head

  let insideTable = false
  syntaxTree(state).iterate({
    from: pos, to: pos,
    enter(node) {
      if (node.type.name === 'Table') { insideTable = true; return false }
    },
  })
  if (insideTable) return false

  const line = state.doc.lineAt(pos)

  if (direction === 'down') {
    const nextPos = line.to + 1
    if (nextPos >= state.doc.length) return false

    let tableFrom = null
    syntaxTree(state).iterate({
      from: nextPos, to: nextPos,
      enter(node) {
        if (node.type.name === 'Table') { tableFrom = node.from; return false }
      },
    })
    if (tableFrom !== null) {
      view.dispatch({ selection: { anchor: tableFrom } })
      return true
    }
  } else {
    if (line.from === 0) return false
    const prevPos = line.from - 1

    let tableTo = null
    syntaxTree(state).iterate({
      from: prevPos, to: prevPos,
      enter(node) {
        if (node.type.name === 'Table') { tableTo = node.to; return false }
      },
    })
    if (tableTo !== null) {
      const toLine = state.doc.lineAt(tableTo > 0 ? tableTo - 1 : tableTo)
      view.dispatch({ selection: { anchor: toLine.to } })
      return true
    }
  }

  return false
}

const livePreviewTheme = EditorView.baseTheme({
  '.cm-lp-bold': {
    fontWeight: 'bold',
  },
  '.cm-lp-italic': {
    fontStyle: 'italic',
  },
  '.cm-lp-strike': {
    textDecoration: 'line-through',
  },
  '.cm-lp-link': {
    color: 'var(--color-accent)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-lp-inline-code': {
    backgroundColor: 'var(--color-chrome-mid)',
    borderRadius: '3px',
    padding: '1px 4px',
  },
  '.cm-lp-blockquote-line': {
    borderLeft: '2px solid var(--color-rule)',
    paddingLeft: '14px',
  },
  '.cm-lp-code-block-line': {
    backgroundColor: 'var(--color-chrome-mid)',
  },
  '.cm-lp-fence-line': {
    opacity: '0.35',
    fontSize: '0.8em',
  },
  '.cm-lp-hr': {
    border: 'none',
    borderTop: '1px solid var(--color-rule)',
    margin: '8px 0',
    display: 'block',
  },
  '.cm-lp-table-wrap': {
    margin: '4px 0',
    overflowX: 'auto',
    display: 'block',
    cursor: 'text',
    userSelect: 'none',
  },
  '.cm-lp-table': {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 'var(--editor-size)',
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-ink)',
  },
  '.cm-lp-table th': {
    fontWeight: '600',
    backgroundColor: 'var(--color-chrome-mid)',
    borderBottom: '2px solid var(--color-rule)',
    padding: '6px 12px',
    textAlign: 'left',
    color: 'var(--color-ink)',
  },
  '.cm-lp-table td': {
    padding: '4px 12px',
    borderBottom: '1px solid var(--color-rule)',
    color: 'var(--color-ink-2)',
  },
  '.cm-lp-table tbody tr:hover': {
    backgroundColor: 'var(--color-line-soft)',
  },
  '.cm-lp-image-wrap': {
    display: 'block',
    margin: '4px 0',
    lineHeight: '0',
  },
  '.cm-lp-image-wrap img': {
    maxWidth: '100%',
    maxHeight: '400px',
    borderRadius: '4px',
    display: 'block',
  },
  '.cm-lp-image-placeholder': {
    display: 'block',
    padding: '12px',
    color: 'var(--color-ink-4)',
    fontSize: 'var(--editor-size)',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.4',
  },
})

export function livePreviewExtension(isEnabled, getFilePath) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this._enabled = isEnabled()
        this.decorations = buildDecorations(view, isEnabled, getFilePath)
      }

      update(update) {
        const nowEnabled = isEnabled()
        if (
          nowEnabled !== this._enabled ||
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.startState.facet(EditorView.darkTheme) !== update.state.facet(EditorView.darkTheme)
        ) {
          this._enabled = nowEnabled
          this.decorations = buildDecorations(update.view, isEnabled, getFilePath)
        }
      }
    },
    { decorations: (v) => v.decorations },
  )

  let tableEnabled = isEnabled()
  const tableField = StateField.define({
    create(state) {
      return buildTableDecorations(state, isEnabled)
    },
    update(value, tr) {
      const nowEnabled = isEnabled()
      if (nowEnabled !== tableEnabled || tr.docChanged || tr.selection) {
        tableEnabled = nowEnabled
        return buildTableDecorations(tr.state, isEnabled)
      }
      return value
    },
    provide: f => EditorView.decorations.from(f),
  })

  const tableNav = Prec.high(keymap.of([
    { key: 'ArrowDown', run: view => navigateIntoTable(view, 'down', isEnabled) },
    { key: 'ArrowUp', run: view => navigateIntoTable(view, 'up', isEnabled) },
  ]))

  const tableMouse = Prec.high(EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!isEnabled()) return false
      const target = event.target
      const wrapper = target instanceof Element ? target.closest('.cm-lp-table-wrap') : null
      if (!wrapper) return false
      const tableFrom = Number(wrapper.getAttribute('data-mim-table-from'))
      if (!Number.isFinite(tableFrom)) return false
      event.preventDefault()
      view.dispatch({ selection: { anchor: tableFrom }, scrollIntoView: true })
      view.focus()
      return true
    },
  }))

  return [plugin, tableField, tableNav, tableMouse, livePreviewTheme]
}
