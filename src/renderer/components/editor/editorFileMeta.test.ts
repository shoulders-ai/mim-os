import { describe, expect, it } from 'vitest'
import {
  extractFileVersion,
  fileExtensionForTelemetry,
  fileLabel,
  formatCompactNumber,
  suggestedSavePath,
} from './editorFileMeta.js'

describe('editorFileMeta', () => {
  it('derives a display label from a path', () => {
    expect(fileLabel('docs/report.md')).toBe('report.md')
    expect(fileLabel('')).toBe('Untitled')
  })

  it('normalizes file extensions for telemetry', () => {
    expect(fileExtensionForTelemetry('docs/Report.MD')).toBe('md')
    expect(fileExtensionForTelemetry('README')).toBe('none')
    expect(fileExtensionForTelemetry('.env')).toBe('none')
  })

  it('formats compact counts for the status bar', () => {
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(1200)).toBe('1.2k')
    expect(formatCompactNumber(10_500)).toBe('11k')
  })

  it('suggests a markdown save path for unnamed drafts', () => {
    expect(suggestedSavePath({ path: 'docs/a.md', name: 'Ignored' })).toBe('docs/a.md')
    expect(suggestedSavePath({ path: '', name: 'Draft' })).toBe('Draft.md')
    expect(suggestedSavePath({ path: '', name: 'notes.txt' })).toBe('notes.txt')
    expect(suggestedSavePath({ path: '', name: '   ' })).toBe('Untitled.md')
  })

  it('extracts file versions from fs tool responses', () => {
    expect(extractFileVersion({
      version: { hash: 'abc', size: 10, mtimeMs: 20, modifiedAt: '2026-06-16T12:00:00Z' },
    })).toEqual({ hash: 'abc', size: 10, mtimeMs: 20, modifiedAt: '2026-06-16T12:00:00Z' })

    expect(extractFileVersion({ hash: 'legacy' })).toEqual({ hash: 'legacy' })
    expect(extractFileVersion({ version: { size: 10 } })).toBeUndefined()
  })
})
