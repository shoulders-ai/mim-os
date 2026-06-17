import { ViewPlugin } from '@codemirror/view'

const HEADING_RE = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/

export function extractOutline(doc) {
  const items = []
  const cursor = doc.iterLines()
  let line = 1
  let from = 0

  while (!cursor.next().done) {
    const text = cursor.value
    const match = text.match(HEADING_RE)
    if (match) {
      items.push({
        level: match[1].length,
        text: cleanHeadingText(match[2]),
        line,
        from,
      })
    }
    from += text.length + 1
    line += 1
  }

  return items
}

function cleanHeadingText(text) {
  return text
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
    .replace(/[`*_~[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function outlineSignature(items) {
  return items.map((item) => `${item.level}:${item.line}:${item.from}:${item.text}`).join('\n')
}

function scheduleIdle(fn, timeout = 400) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 0)
  return () => clearTimeout(id)
}

export function outlineExtension({ onOutlineChange, delay = 160 } = {}) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.timer = null
      this.cancelIdle = null
      this.signature = ''
      this.schedule(0)
    }

    update(update) {
      if (update.docChanged) this.schedule(delay)
    }

    schedule(ms) {
      this.clearScheduled()
      this.timer = setTimeout(() => {
        this.timer = null
        this.cancelIdle = scheduleIdle(() => {
          this.cancelIdle = null
          this.emit()
        })
      }, ms)
    }

    emit() {
      if (typeof onOutlineChange !== 'function') return
      const outline = extractOutline(this.view.state.doc)
      const signature = outlineSignature(outline)
      if (signature === this.signature) return
      this.signature = signature
      onOutlineChange(outline)
    }

    clearScheduled() {
      if (this.timer != null) {
        clearTimeout(this.timer)
        this.timer = null
      }
      if (this.cancelIdle) {
        this.cancelIdle()
        this.cancelIdle = null
      }
    }

    destroy() {
      this.clearScheduled()
    }
  })
}
