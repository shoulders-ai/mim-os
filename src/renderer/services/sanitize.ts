import DOMPurify from 'dompurify'
import { stripComments } from '@main/comments/model.js'

const purify = DOMPurify(window)

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// No interactive controls (button, select, textarea, …) may ever be allowed
// here: chat markdown is model output and prompt-injectable, and a surviving
// control renders as native-looking UI (a fake Approve button). Trusted
// controls (e.g. code-block copy) are injected as real DOM by components
// AFTER sanitization. The lone exception is `input`, kept for GFM task-list
// checkboxes, which render disabled.
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'strong', 'em', 'del', 's', 'mark', 'sub', 'sup',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'caption', 'colgroup', 'col',
  'div', 'span', 'section',
  'details', 'summary', 'figure', 'figcaption',
  'dl', 'dt', 'dd', 'abbr', 'small', 'u',
  'input',
]

const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'src', 'alt', 'title', 'width', 'height',
  'class', 'id',
  'colspan', 'rowspan', 'align', 'span',
  'type', 'checked', 'disabled', 'open',
]

export function sanitizeHtml(dirty: string): string {
  return purify.sanitize(stripComments(dirty).text, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}

// Exported for tests only: happy-dom's parser mangles tags regardless of the
// allowlist, so config regressions can only be pinned by asserting the lists.
export { ALLOWED_TAGS as _ALLOWED_TAGS, ALLOWED_ATTR as _ALLOWED_ATTR }
