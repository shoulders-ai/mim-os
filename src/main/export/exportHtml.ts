// Markdown → self-contained print HTML. The composed document carries every
// style inline (fonts, base stylesheet) so the hidden render window needs no
// network or app server. Visual styling lives in
// resources/export-templates/_base.css; this module only renders markdown and
// translates the DocumentStyle into body classes + CSS variables.

import hljs from 'highlight.js'
import { Marked } from 'marked'
import type { Reference } from './citations.js'
import { FONT_FAMILIES, MONO_CSS_STACK, type DocumentStyle, type FontFamilyId } from './documentStyle.js'

export interface ComposeHtmlOptions {
  markdown: string
  style: DocumentStyle
  fontFamily: FontFamilyId
  fontSizePt: number
  title?: string
  /** file:// URL (trailing slash) of the source document's directory — resolves relative image paths. */
  baseHref?: string
  /** file:// URL (trailing slash) of the workspace root — resolves /-rooted image paths. */
  workspaceHref?: string
  /** @font-face declarations, from buildFontFaceCss(). Omitted in tests. */
  fontsCss?: string
  baseCss: string
  bibliography?: Reference[]
  bibliographyTitle?: string
}

export function composeDocumentHtml(options: ComposeHtmlOptions): string {
  const { style } = options
  const marked = createMarked(options.workspaceHref)
  const body = sanitizeForPrint(marked.parse(options.markdown, { async: false }))
  const title = options.title?.trim() || extractTitle(options.markdown) || 'Document'

  const bodyClasses = [
    'doc',
    style.numberedHeadings ? 'doc--numbered' : '',
    style.titleFirstH1 ? 'doc--title-h1' : '',
    style.justify ? 'doc--justify' : '',
    style.columns === 2 ? 'doc--two-col' : '',
  ].filter(Boolean).join(' ')

  const font = FONT_FAMILIES[options.fontFamily]
  const vars = [
    `--doc-font: ${font.cssStack};`,
    `--doc-mono: ${MONO_CSS_STACK};`,
    `--doc-size: ${options.fontSizePt}pt;`,
  ].join(' ')

  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    options.baseHref ? `<base href="${escapeAttr(options.baseHref)}">` : '',
    options.fontsCss ? `<style>\n${options.fontsCss}\n</style>` : '',
    `<style>\n${options.baseCss}\n</style>`,
    `<style>:root { ${vars} }</style>`,
    '</head>',
    `<body class="${bodyClasses}">`,
    '<main class="doc-body">',
    body,
    '</main>',
    renderBibliography(options.bibliography, options.bibliographyTitle),
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n')
}

function createMarked(workspaceHref?: string): Marked {
  const marked = new Marked({ gfm: true })
  marked.use({
    renderer: {
      image({ href, title, text }) {
        let src = href ?? ''
        // Leading-slash paths are workspace-relative in Mim documents (same
        // convention as the live preview); everything else resolves against
        // the <base href> document directory.
        if (workspaceHref && src.startsWith('/')) src = workspaceHref + src.replace(/^\/+/, '')
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
        return `<img src="${escapeAttr(src)}" alt="${escapeAttr(text ?? '')}"${titleAttr}>`
      },
      code({ text, lang }) {
        const language = lang && hljs.getLanguage(lang) ? lang : undefined
        const highlighted = language
          ? hljs.highlight(text, { language }).value
          : escapeHtml(text)
        const langClass = language ? ` language-${escapeAttr(language)}` : ''
        return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>\n`
      },
    },
  })
  return marked
}

function extractTitle(markdown: string): string | null {
  const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown)
  if (!match) return null
  return match[1].replace(/[*_`~]/g, '').trim() || null
}

function renderBibliography(refs: Reference[] | undefined, title?: string): string {
  if (!refs || refs.length === 0) return ''
  const items = refs.map((ref) => {
    const runs = ref.runs
      .map(run => (run.italic ? `<em>${escapeHtml(run.text)}</em>` : escapeHtml(run.text)))
      .join('')
    const label = ref.label ? `<span class="doc-ref-label">${escapeHtml(ref.label)}</span> ` : ''
    return `<p class="doc-ref">${label}${runs}</p>`
  }).join('\n')
  return [
    '<section class="doc-references">',
    `<h2 class="doc-references-title">${escapeHtml(title || 'References')}</h2>`,
    items,
    '</section>',
  ].join('\n')
}

// Defense in depth for embedded raw HTML. The render window is sandboxed with
// no preload and no node access; this pass just keeps stray scripts from
// altering the user's own document during print.
function sanitizeForPrint(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1=$2#$2')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;')
}

// ── Fonts ──────────────────────────────────────────────────────────────

interface FontFile {
  family: string
  file: string
  style: 'normal' | 'italic'
  weight: string
}

const BUNDLED_FONTS: FontFile[] = [
  { family: 'Lora', file: 'Lora-VariableFont_wght.ttf', style: 'normal', weight: '400 700' },
  { family: 'Lora', file: 'Lora-Italic-VariableFont_wght.ttf', style: 'italic', weight: '400 700' },
  { family: 'Satoshi', file: 'Satoshi-Variable.ttf', style: 'normal', weight: '300 900' },
  { family: 'Satoshi', file: 'Satoshi-VariableItalic.ttf', style: 'italic', weight: '300 900' },
  { family: 'Zilla Slab', file: 'ZillaSlab-Regular.ttf', style: 'normal', weight: '400' },
  { family: 'Zilla Slab', file: 'ZillaSlab-SemiBold.ttf', style: 'normal', weight: '600' },
  { family: 'Zilla Slab', file: 'ZillaSlab-Bold.ttf', style: 'normal', weight: '700' },
  { family: 'JetBrains Mono', file: 'JetBrainsMono-VariableFont_wght.ttf', style: 'normal', weight: '100 800' },
  { family: 'JetBrains Mono', file: 'JetBrainsMono-Italic-VariableFont_wght.ttf', style: 'italic', weight: '100 800' },
]

export function buildFontFaceCss(fontsDirUrl: string): string {
  const base = fontsDirUrl.replace(/\/+$/, '')
  return BUNDLED_FONTS.map(font => [
    '@font-face {',
    `  font-family: '${font.family}';`,
    `  src: url('${base}/${encodeURI(font.file)}') format('truetype');`,
    `  font-style: ${font.style};`,
    `  font-weight: ${font.weight};`,
    '}',
  ].join('\n')).join('\n')
}
