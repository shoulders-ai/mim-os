import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Strikethrough } from '@lezer/markdown'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])

// Pathless drafts (untitled tabs) are markdown: that is the editor's default
// authoring surface and what Save suggests as the extension.
export function isMarkdownPath(path) {
  if (!path) return true
  const ext = extensionOf(path)
  return MARKDOWN_EXTENSIONS.has(ext)
}

export function markdownLanguageExtension() {
  return markdown({ base: markdownLanguage, extensions: [Strikethrough] })
}

// Resolve the CodeMirror language extension for a file path. Markdown is
// bundled; everything else lazy-loads from @codemirror/language-data so the
// grammar only ships when a matching file is opened. Unknown extensions get
// plain text (no language).
export async function languageExtensionForPath(path) {
  if (isMarkdownPath(path)) return markdownLanguageExtension()
  const name = baseName(path)
  const description = LanguageDescription.matchFilename(languages, name)
  if (!description) return []
  try {
    return await description.load()
  } catch {
    return []
  }
}

function baseName(path) {
  return path.split(/[/\\]/).pop() || path
}

function extensionOf(path) {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}
