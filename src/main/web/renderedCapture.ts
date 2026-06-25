export interface CapturedRenderedDocument {
  title: string
  html: string
  signals: {
    visible_text_chars: number
    link_count: number
    button_count: number
    form_control_count: number
    table_row_count: number
    heading_count: number
    image_count: number
  }
}

export function captureRenderedDocument(): CapturedRenderedDocument {
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const skipTags = new Set(['script', 'style', 'noscript', 'meta', 'link', 'title', 'head'])
  const keepAttrs = new Set([
    'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'scope', 'headers',
    'type', 'value', 'placeholder', 'role', 'aria-label', 'aria-labelledby',
    'aria-describedby', 'name', 'id',
  ])

  function escapeText(value: unknown): string {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function escapeAttr(value: unknown): string {
    return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
  }

  function isHidden(el: Element): boolean {
    const tag = el.tagName ? el.tagName.toLowerCase() : ''
    if (tag === 'html' || tag === 'body') return false
    if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return true
    try {
      const style = window.getComputedStyle(el)
      const contentVisibility = (style as CSSStyleDeclaration & { contentVisibility?: string }).contentVisibility
      if (style.display === 'none' || style.visibility === 'hidden' || contentVisibility === 'hidden') return true
    } catch (_) {}
    return false
  }

  function serializeAttrs(el: Element): string {
    const parts: string[] = []
    for (const attr of Array.from(el.attributes || [])) {
      const name = attr.name.toLowerCase()
      if (!keepAttrs.has(name) && !name.startsWith('aria-')) continue
      let value = attr.value || ''
      const elementWithUrls = el as Element & { href?: string, src?: string }
      if (name === 'href' && typeof elementWithUrls.href === 'string' && elementWithUrls.href) value = elementWithUrls.href
      if (name === 'src' && typeof elementWithUrls.src === 'string' && elementWithUrls.src) value = elementWithUrls.src
      if (value === '') parts.push(name)
      else parts.push(`${name}="${escapeAttr(value)}"`)
    }
    return parts.length ? ` ${parts.join(' ')}` : ''
  }

  function serializeChildren(parent: Node): string {
    return Array.from(parent.childNodes || []).map(serializeNode).join('')
  }

  function serializeIframe(el: Element): string {
    try {
      const doc = (el as HTMLIFrameElement).contentDocument
      if (!doc?.body) return ''
      const title = doc.title ? `<h2>Frame: ${escapeText(doc.title)}</h2>` : ''
      return `<section>${title}${serializeChildren(doc.body)}</section>`
    } catch (_) {
      return ''
    }
  }

  function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue || '')
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return serializeChildren(node)

    const el = node as Element
    const tag = el.tagName ? el.tagName.toLowerCase() : ''
    if (!tag || skipTags.has(tag) || isHidden(el)) return ''
    if (tag === 'iframe' || tag === 'frame') return serializeIframe(el)

    const attrs = serializeAttrs(el)
    if (voidTags.has(tag)) return `<${tag}${attrs} />`

    let children = ''
    const shadowRoot = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
    if (shadowRoot) children += `<section><h2>Shadow DOM</h2>${serializeChildren(shadowRoot)}</section>`
    children += serializeChildren(el)
    return `<${tag}${attrs}>${children}</${tag}>`
  }

  function visibleText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
    if (node.nodeType === Node.ELEMENT_NODE && isHidden(node as Element)) return ''
    return Array.from(node.childNodes || []).map(visibleText).join(' ')
  }

  function countVisible(selector: string): number {
    return Array.from(document.querySelectorAll(selector)).filter(el => !isHidden(el)).length
  }

  const root = document.body || document.documentElement
  const text = root ? visibleText(root).replace(/\s+/g, ' ').trim() : ''
  return {
    title: document.title || '',
    html: `<body>${root ? serializeChildren(root) : ''}</body>`,
    signals: {
      visible_text_chars: text.length,
      link_count: countVisible('a[href]'),
      button_count: countVisible('button, [role="button"]'),
      form_control_count: countVisible('input, select, textarea'),
      table_row_count: countVisible('tr'),
      heading_count: countVisible('h1, h2, h3, h4, h5, h6, [role="heading"]'),
      image_count: countVisible('img, picture, svg'),
    },
  }
}

export const CAPTURE_RENDERED_HTML_SCRIPT = `(${captureRenderedDocument.toString()})()`
