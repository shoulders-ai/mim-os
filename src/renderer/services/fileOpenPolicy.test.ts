import { describe, expect, it } from 'vitest'
import {
  defaultOpenLabelForPath,
  defaultOpenTargetForPath,
  fileKindForPath,
  isEditorOpenablePath,
  resolveSniffTarget,
} from './fileOpenPolicy.js'

describe('file open policy', () => {
  it('routes text-like files to the Artifact editor', () => {
    expect(defaultOpenTargetForPath('README.md')).toBe('editor')
    expect(defaultOpenTargetForPath('src/renderer/App.vue')).toBe('editor')
    expect(defaultOpenLabelForPath('src/main/index.ts')).toBe('Open in Editor')
    expect(isEditorOpenablePath('docs/design-system.md')).toBe(true)
  })

  it('routes Word documents to the native app with Word-specific copy', () => {
    expect(defaultOpenTargetForPath('docs/proposal.docx')).toBe('native')
    expect(fileKindForPath('docs/proposal.docx')).toBe('Word')
    expect(defaultOpenLabelForPath('docs/proposal.docx')).toBe('Open in Microsoft Word')
    expect(isEditorOpenablePath('docs/proposal.docx')).toBe(false)
  })

  it('routes absolute paths and known binary formats away from the editor', () => {
    expect(defaultOpenTargetForPath('/Users/test/Desktop/report.md')).toBe('native')
    expect(defaultOpenTargetForPath('data/workbook.xlsx')).toBe('native')
    expect(defaultOpenLabelForPath('data/workbook.xlsx')).toBe('Open in default app')
    expect(defaultOpenLabelForPath('outputs/final.pdf')).toBe('Open in Editor')
  })

  it('routes delimited text tables to the in-app table viewer', () => {
    expect(defaultOpenTargetForPath('data/input.csv')).toBe('table')
    expect(defaultOpenTargetForPath('data/input.tsv')).toBe('table')
    expect(defaultOpenTargetForPath('data/input.tab')).toBe('table')
    expect(defaultOpenLabelForPath('data/input.csv')).toBe('Open in Editor')
    expect(isEditorOpenablePath('data/input.tsv')).toBe(true)
  })

  it('routes renderable images to the in-app image viewer', () => {
    expect(defaultOpenTargetForPath('outputs/plot.png')).toBe('image')
    expect(defaultOpenTargetForPath('assets/logo.svg')).toBe('image')
    expect(defaultOpenTargetForPath('shots/photo.JPG')).toBe('image')
    expect(defaultOpenTargetForPath('anim.gif')).toBe('image')
    expect(defaultOpenTargetForPath('pic.webp')).toBe('image')
    expect(defaultOpenLabelForPath('outputs/plot.png')).toBe('Open in Editor')
    expect(isEditorOpenablePath('a/plot.png')).toBe(true)
  })

  it('keeps Chromium-unrenderable image formats native', () => {
    expect(defaultOpenTargetForPath('shots/photo.heic')).toBe('native')
    expect(defaultOpenTargetForPath('scans/page.tif')).toBe('native')
    expect(defaultOpenTargetForPath('scans/page.tiff')).toBe('native')
    expect(isEditorOpenablePath('shots/photo.heic')).toBe(false)
  })

  it('routes R, R Markdown, and Quarto files to the editor with kind labels', () => {
    expect(defaultOpenTargetForPath('analysis/fit.R')).toBe('editor')
    expect(defaultOpenTargetForPath('analysis/fit.r')).toBe('editor')
    expect(defaultOpenTargetForPath('report.Rmd')).toBe('editor')
    expect(defaultOpenTargetForPath('report.qmd')).toBe('editor')
    expect(fileKindForPath('analysis/fit.R')).toBe('R')
    expect(fileKindForPath('report.Rmd')).toBe('R Markdown')
    expect(fileKindForPath('report.qmd')).toBe('Quarto')
  })

  it('labels common workspace object kinds', () => {
    expect(fileKindForPath('docs')).toBe('File')
    expect(fileKindForPath('notes.md')).toBe('Markdown')
    expect(fileKindForPath('package.json')).toBe('JSON')
    expect(fileKindForPath('diagram.png')).toBe('Image')
    expect(fileKindForPath('archive.zip')).toBe('Archive')
  })
})

describe('file open policy edge cases', () => {
  it('opens well-known dotfiles and extensionless basenames in the editor', () => {
    expect(defaultOpenTargetForPath('.env')).toBe('editor')
    expect(defaultOpenTargetForPath('config/.gitignore')).toBe('editor')
    expect(defaultOpenTargetForPath('Dockerfile')).toBe('editor')
    expect(defaultOpenTargetForPath('Makefile')).toBe('editor')
    expect(defaultOpenTargetForPath('README')).toBe('editor')
  })

  it('defers unknown dotfiles and extensionless files to a content sniff', () => {
    expect(defaultOpenTargetForPath('.bashrc')).toBe('sniff')
    expect(defaultOpenTargetForPath('scripts/run')).toBe('sniff')
    expect(defaultOpenTargetForPath('weird.')).toBe('sniff')
    expect(defaultOpenTargetForPath('app.log')).toBe('sniff')
  })

  it('routes PDFs to the in-app viewer target', () => {
    expect(defaultOpenTargetForPath('outputs/deck.pdf')).toBe('pdf')
    expect(defaultOpenTargetForPath('/Users/test/deck.pdf')).toBe('native')
  })

  it('matches extensions case-insensitively', () => {
    expect(defaultOpenTargetForPath('NOTES.MD')).toBe('editor')
    expect(defaultOpenTargetForPath('PHOTO.HEIC')).toBe('native')
    expect(fileKindForPath('NOTES.MD')).toBe('Markdown')
  })

  it('treats Windows-style absolute paths as native, like POSIX ones', () => {
    expect(defaultOpenTargetForPath('C:\\Users\\test\\notes.md')).toBe('native')
    expect(defaultOpenTargetForPath('C:/Users/test/notes.md')).toBe('native')
    expect(defaultOpenTargetForPath('\\\\server\\share\\notes.md')).toBe('native')
  })

  it('treats an empty path as native and unknown extensions as sniffable', () => {
    expect(defaultOpenTargetForPath('')).toBe('native')
    expect(defaultOpenTargetForPath('blob.xyz')).toBe('sniff')
  })

  it('uppercases unknown extensions as the kind label and keeps named kinds', () => {
    expect(fileKindForPath('blob.xyz')).toBe('XYZ')
    expect(fileKindForPath('data.csv')).toBe('CSV')
    expect(fileKindForPath('data.tsv')).toBe('TSV')
    expect(fileKindForPath('data.xlsx')).toBe('Spreadsheet')
    expect(fileKindForPath('deck.key')).toBe('Presentation')
    expect(fileKindForPath('.gitignore')).toBe('File')
    expect(fileKindForPath('nested/dir/package.json')).toBe('JSON')
  })

  it('classifies basenames from full relative paths', () => {
    expect(defaultOpenTargetForPath('deep/nested/Dockerfile')).toBe('editor')
    expect(defaultOpenTargetForPath('deep/nested/photo.heic')).toBe('native')
  })
})

describe('resolveSniffTarget', () => {
  it('resolves text content to the editor', async () => {
    const read = async () => 'plain shell script\nwith lines\n'
    await expect(resolveSniffTarget('scripts/run', read)).resolves.toBe('editor')
  })

  it('resolves empty files to the editor', async () => {
    await expect(resolveSniffTarget('empty.log', async () => '')).resolves.toBe('editor')
  })

  it('resolves NUL bytes and heavy replacement-char content to native', async () => {
    await expect(resolveSniffTarget('bin', async () => 'ab\u0000cd')).resolves.toBe('native')
    await expect(
      resolveSniffTarget('mangled', async () => '����ab'),
    ).resolves.toBe('native')
  })

  it('resolves unreadable files to native', async () => {
    const read = async () => { throw new Error('EISDIR') }
    await expect(resolveSniffTarget('strange', read)).resolves.toBe('native')
  })

  it('passes through non-sniff targets without reading', async () => {
    let reads = 0
    const read = async () => { reads++; return 'x' }
    await expect(resolveSniffTarget('notes.md', read)).resolves.toBe('editor')
    await expect(resolveSniffTarget('deck.pdf', read)).resolves.toBe('pdf')
    await expect(resolveSniffTarget('data.csv', read)).resolves.toBe('table')
    await expect(resolveSniffTarget('img.png', read)).resolves.toBe('image')
    await expect(resolveSniffTarget('img.heic', read)).resolves.toBe('native')
    expect(reads).toBe(0)
  })
})
