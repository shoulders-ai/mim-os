/*
 * Portions adapted from markanywhere by Kazimierz Pogoda / Xemantic.
 * Original project: https://github.com/xemantic/markanywhere
 * Licensed under the Apache License, Version 2.0.
 *
 * This TypeScript port changes the runtime from kdriver/CDP snapshots to
 * Electron page execution, while preserving the Markanywhere contract relevant
 * to Mim's live browser: dense action refs, ref:<id>:<href> link encoding, and
 * ref-addressable controls.
 */

export const MARKANYWHERE_REF_ATTRIBUTE = 'data-markanywhere-ref'
export const ACTIONABLE_REF_SCHEME = 'ref'
export const ACTIONABLE_REF_ATTRIBUTE = 'ref'

export interface MarkanywhereActionRef {
  ref: string
  uid: string
  tag: string
  role?: string
  label: string
  href?: string
  value?: string
  disabled?: boolean
}

export interface MarkanywherePageCapture {
  title: string
  url: string
  markdown: string
  refs: MarkanywhereActionRef[]
  signals: {
    visible_text_chars: number
    ref_count: number
    link_count: number
    button_count: number
    form_control_count: number
    heading_count: number
  }
}

export function encodeActionableRefHref(ref: string, href: string): string {
  return `${ACTIONABLE_REF_SCHEME}:${ref}:${href}`
}

export function decodeActionableRefHref(value: string): { ref: string, href: string } | null {
  const prefix = `${ACTIONABLE_REF_SCHEME}:`
  if (!value.startsWith(prefix)) return null
  const rest = value.slice(prefix.length)
  const separator = rest.indexOf(':')
  if (separator < 0) return null
  return {
    ref: rest.slice(0, separator),
    href: rest.slice(separator + 1),
  }
}

export function captureMarkanywherePage(): MarkanywherePageCapture {
  const ACTIONABLE_ROLES = new Set([
    'link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch',
    'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'tab', 'slider', 'spinbutton',
  ])
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'meta', 'link'])
  const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr',
    'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
  ])
  const HEADING_RE = /^h[1-6]$/
  const ELEMENT_UID = '__mimMarkanywhereElementUid'
  const NEXT_UID = '__mimMarkanywhereNextElementUid'

  function encodeRefHref(ref: string, href: string): string {
    return `ref:${ref}:${href}`
  }

  function normalizeText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim()
  }

  function escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function escapeMarkdownText(value: unknown): string {
    return String(value ?? '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1')
  }

  function markdownText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ')
  }

  function elementTag(el: Element): string {
    return el.tagName ? el.tagName.toLowerCase() : ''
  }

  function elementRole(el: Element): string | undefined {
    const explicit = el.getAttribute('role')?.trim().toLowerCase()
    if (explicit) return explicit
    const tag = elementTag(el)
    const inputType = (el.getAttribute('type') || '').toLowerCase()
    if (tag === 'a' && (el as HTMLAnchorElement).href) return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'option') return 'option'
    if (tag === 'input') {
      if (inputType === 'search') return 'searchbox'
      if (inputType === 'checkbox') return 'checkbox'
      if (inputType === 'radio') return 'radio'
      if (inputType === 'range') return 'slider'
      if (inputType === 'number') return 'spinbutton'
      if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') return 'button'
      return 'textbox'
    }
    return undefined
  }

  function isHidden(el: Element): boolean {
    const tag = elementTag(el)
    if (tag === 'html' || tag === 'body') return false
    if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true
    try {
      const style = window.getComputedStyle(el)
      const contentVisibility = (style as CSSStyleDeclaration & { contentVisibility?: string }).contentVisibility
      if (style.display === 'none' || style.visibility === 'hidden' || contentVisibility === 'hidden') return true
    } catch (_) {}
    return false
  }

  function visibleText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
    if (node.nodeType === Node.ELEMENT_NODE && isHidden(node as Element)) return ''
    return Array.from(node.childNodes || []).map(visibleText).join(' ')
  }

  function labelledByText(el: Element): string {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    return ids.map(id => document.getElementById(id)?.textContent || '').join(' ')
  }

  function elementLabel(el: Element): string {
    const tag = elementTag(el)
    const input = el as HTMLInputElement
    const directLabel = el.getAttribute('aria-label')
      || labelledByText(el)
      || el.getAttribute('alt')
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || (tag === 'input' ? input.value : '')
      || el.textContent
      || el.getAttribute('name')
      || tag
    return normalizeText(directLabel)
  }

  function isDisabled(el: Element): boolean {
    return (el as HTMLButtonElement).disabled === true
      || el.hasAttribute('disabled')
      || el.getAttribute('aria-disabled')?.toLowerCase() === 'true'
  }

  function isFocusable(el: Element): boolean {
    const tabIndex = (el as HTMLElement).tabIndex
    if (tabIndex >= 0) return true
    const tag = elementTag(el)
    if (tag === 'a') return Boolean((el as HTMLAnchorElement).href)
    if (['button', 'input', 'select', 'textarea'].includes(tag)) return true
    return (el as HTMLElement).isContentEditable === true
  }

  function isActionable(el: Element): boolean {
    const role = elementRole(el)
    return isFocusable(el) || (role != null && ACTIONABLE_ROLES.has(role))
  }

  function uidFor(el: Element): string {
    const anyEl = el as Element & Record<string, string>
    if (!anyEl[ELEMENT_UID]) {
      const anyWindow = window as unknown as Record<string, number>
      anyWindow[NEXT_UID] = anyWindow[NEXT_UID] || 1
      Object.defineProperty(el, ELEMENT_UID, {
        configurable: true,
        enumerable: false,
        value: String(anyWindow[NEXT_UID]++),
      })
    }
    return anyEl[ELEMENT_UID]
  }

  function attr(name: string, value: unknown): string {
    const text = String(value ?? '')
    return text ? ` ${name}="${escapeHtml(text)}"` : ''
  }

  function countVisible(selector: string): number {
    return Array.from(document.querySelectorAll(selector)).filter(el => !isHidden(el)).length
  }

  const refs: MarkanywhereActionRef[] = []
  let refCounter = 0

  function refFor(el: Element): MarkanywhereActionRef | null {
    if (!isActionable(el)) return null
    const existing = refs.find(item => item.uid === uidFor(el))
    if (existing) return existing
    const ref = String(++refCounter)
    const tag = elementTag(el)
    const role = elementRole(el)
    const htmlEl = el as HTMLInputElement
    const item: MarkanywhereActionRef = {
      ref,
      uid: uidFor(el),
      tag,
      ...(role ? { role } : {}),
      label: elementLabel(el),
      ...((el as HTMLAnchorElement).href ? { href: (el as HTMLAnchorElement).href } : {}),
      ...(typeof htmlEl.value === 'string' ? { value: htmlEl.value } : {}),
      ...(isDisabled(el) ? { disabled: true } : {}),
    }
    refs.push(item)
    return item
  }

  function renderChildren(parent: Node): string {
    return Array.from(parent.childNodes || []).map(renderNode).join('')
  }

  function renderNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return markdownText(node.nodeValue || '')
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return renderChildren(node)

    const el = node as Element
    const tag = elementTag(el)
    if (!tag || SKIP_TAGS.has(tag) || isHidden(el)) return ''

    const ref = refFor(el)
    const childText = renderChildren(el)
    const label = elementLabel(el)

    if (HEADING_RE.test(tag)) {
      return `\n\n${'#'.repeat(Number(tag.slice(1)))} ${childText || escapeMarkdownText(label)}\n\n`
    }
    if (tag === 'a') {
      const href = (el as HTMLAnchorElement).href || el.getAttribute('href') || ''
      const text = childText || escapeMarkdownText(label || href)
      return `[${text}](${ref ? encodeRefHref(ref.ref, href) : href})`
    }
    if (tag === 'button') {
      const type = el.getAttribute('type') || ''
      const disabled = isDisabled(el) ? ' disabled' : ''
      const refAttr = ref ? ` ref="${ref.ref}"` : ''
      return `<button${refAttr}${attr('type', type)}${disabled}>${escapeHtml(label)}</button>`
    }
    if (tag === 'input') {
      const input = el as HTMLInputElement
      const disabled = isDisabled(el) ? ' disabled' : ''
      const checked = input.checked ? ' checked' : ''
      const refAttr = ref ? ` ref="${ref.ref}"` : ''
      return `<input${refAttr}${attr('type', input.type || el.getAttribute('type') || 'text')}${attr('name', input.name)}${attr('placeholder', input.placeholder)} value="${escapeHtml(input.value)}"${disabled}${checked}>`
    }
    if (tag === 'textarea') {
      const textarea = el as HTMLTextAreaElement
      const disabled = isDisabled(el) ? ' disabled' : ''
      const refAttr = ref ? ` ref="${ref.ref}"` : ''
      return `<textarea${refAttr}${attr('name', textarea.name)}${attr('placeholder', textarea.placeholder)}${disabled}>${escapeHtml(textarea.value || textarea.textContent || '')}</textarea>`
    }
    if (tag === 'select') {
      const select = el as HTMLSelectElement
      const disabled = isDisabled(el) ? ' disabled' : ''
      const refAttr = ref ? ` ref="${ref.ref}"` : ''
      return `<select${refAttr}${attr('name', select.name)}${disabled}>${escapeHtml(label)}</select>`
    }
    if (tag === 'img') {
      const src = (el as HTMLImageElement).src || el.getAttribute('src') || ''
      const alt = el.getAttribute('alt') || label
      return alt || src ? `![${escapeMarkdownText(alt)}](${src})` : ''
    }
    if (tag === 'br') return '\n'
    if (tag === 'li') return `\n- ${childText}\n`
    if (tag === 'hr') return '\n\n---\n\n'
    if (tag === 'pre') return `\n\n\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`
    if (BLOCK_TAGS.has(tag)) return `\n\n${childText}\n\n`
    return childText
  }

  const root = document.body || document.documentElement
  const markdown = renderNode(root)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const text = root ? visibleText(root).replace(/\s+/g, ' ').trim() : ''

  return {
    title: document.title || '',
    url: document.location.href,
    markdown,
    refs,
    signals: {
      visible_text_chars: text.length,
      ref_count: refs.length,
      link_count: countVisible('a[href]'),
      button_count: countVisible('button, [role="button"]'),
      form_control_count: countVisible('input, select, textarea'),
      heading_count: countVisible('h1, h2, h3, h4, h5, h6, [role="heading"]'),
    },
  }
}

export const CAPTURE_MARKANYWHERE_PAGE_SCRIPT = `(${captureMarkanywherePage.toString()})()`
