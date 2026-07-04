import { describe, expect, it } from 'vitest'
import { isMarkdownPath, languageExtensionForPath, resolveFenceLanguage } from './language.js'

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

  it('treats R Markdown and Quarto documents as markdown', async () => {
    expect(isMarkdownPath('report.rmd')).toBe(true)
    expect(isMarkdownPath('analysis/report.Rmd')).toBe(true)
    expect(isMarkdownPath('report.qmd')).toBe(true)
    const rmd = await languageExtensionForPath('report.Rmd')
    expect(languageNameOf(rmd)).toBe('markdown')
  })

  it('keeps plain .R as a code file, not markdown', () => {
    expect(isMarkdownPath('analysis/fit.R')).toBe(false)
  })
})

describe('resolveFenceLanguage', () => {
  it('normalizes knitr-style fence info strings', () => {
    expect(resolveFenceLanguage('{r}')?.name).toBe('R')
    expect(resolveFenceLanguage('{r, echo=FALSE}')?.name).toBe('R')
    expect(resolveFenceLanguage('{r setup, include=FALSE}')?.name).toBe('R')
    expect(resolveFenceLanguage('{python}')?.name).toBe('Python')
  })

  it('matches plain fence info strings', () => {
    expect(resolveFenceLanguage('r')?.name).toBe('R')
    expect(resolveFenceLanguage('js')?.name).toBe('JavaScript')
  })

  it('returns null for unknown or empty info strings without throwing', () => {
    expect(resolveFenceLanguage('{foo}')).toBeNull()
    expect(resolveFenceLanguage('')).toBeNull()
    expect(resolveFenceLanguage('{}')).toBeNull()
  })
})
