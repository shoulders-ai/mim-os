import { describe, expect, it } from 'vitest'
import { isMarkdownPath, languageExtensionForPath } from './language.js'

function languageNameOf(extension: unknown): string | undefined {
  // A LanguageSupport instance carries its language; bare arrays do not.
  const support = extension as { language?: { name?: string } }
  return support?.language?.name
}

describe('editor language selection', () => {
  it('treats markdown and pathless drafts as markdown', () => {
    expect(isMarkdownPath('notes.md')).toBe(true)
    expect(isMarkdownPath('deep/nested/notes.markdown')).toBe(true)
    expect(isMarkdownPath('story.mdx')).toBe(true)
    expect(isMarkdownPath('')).toBe(true)
    expect(isMarkdownPath('script.py')).toBe(false)
    expect(isMarkdownPath('data.json')).toBe(false)
  })

  it('returns the markdown extension for markdown paths and drafts', async () => {
    const md = await languageExtensionForPath('notes.md')
    expect(languageNameOf(md)).toBe('markdown')
    const draft = await languageExtensionForPath('')
    expect(languageNameOf(draft)).toBe('markdown')
  })

  it('loads a matching language for known code extensions', async () => {
    const py = await languageExtensionForPath('scripts/tool.py')
    expect(languageNameOf(py)).toBe('python')
    const ts = await languageExtensionForPath('src/main.ts')
    expect(languageNameOf(ts)).toBe('typescript')
    const json = await languageExtensionForPath('package.json')
    expect(languageNameOf(json)).toBe('json')
  })

  it('falls back to plain text for unknown extensions', async () => {
    const unknown = await languageExtensionForPath('blob.xyz')
    expect(languageNameOf(unknown)).toBeUndefined()
    expect(unknown).toEqual([])
  })
})
