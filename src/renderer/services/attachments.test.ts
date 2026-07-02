import { describe, expect, it } from 'vitest'
import {
  isAttachmentPlaceholder,
  isImageType,
  isPdfType,
  isTextType,
  mediaTypeFromFilename,
  textToDataUrl,
  toDataUrl,
  toFileUIParts,
  toContextUIParts,
  toUserMessageParts,
  validateFileSize,
} from './attachments.js'

describe('mediaTypeFromFilename', () => {
  it('returns image media types for supported image extensions', () => {
    expect(mediaTypeFromFilename('photo.png')).toBe('image/png')
    expect(mediaTypeFromFilename('photo.jpg')).toBe('image/jpeg')
    expect(mediaTypeFromFilename('photo.JPEG')).toBe('image/jpeg')
    expect(mediaTypeFromFilename('animation.gif')).toBe('image/gif')
    expect(mediaTypeFromFilename('photo.webp')).toBe('image/webp')
  })

  it('returns document media types for supported file extensions', () => {
    expect(mediaTypeFromFilename('document.pdf')).toBe('application/pdf')
    expect(mediaTypeFromFilename('file.txt')).toBe('text/plain')
    expect(mediaTypeFromFilename('notes.md')).toBe('text/markdown')
    expect(mediaTypeFromFilename('data.csv')).toBe('text/csv')
    expect(mediaTypeFromFilename('config.json')).toBe('application/json')
    expect(mediaTypeFromFilename('config.yaml')).toBe('text/yaml')
    expect(mediaTypeFromFilename('config.yml')).toBe('text/yaml')
    expect(mediaTypeFromFilename('data.xml')).toBe('text/xml')
  })

  it('returns null for unsupported or missing extensions', () => {
    expect(mediaTypeFromFilename('file.docx')).toBe(null)
    expect(mediaTypeFromFilename('file.exe')).toBe(null)
    expect(mediaTypeFromFilename('noext')).toBe(null)
    expect(mediaTypeFromFilename('')).toBe(null)
  })
})

describe('media type predicates', () => {
  it('detects image media types', () => {
    expect(isImageType('image/png')).toBe(true)
    expect(isImageType('image/jpeg')).toBe(true)
    expect(isImageType('application/pdf')).toBe(false)
    expect(isImageType(null)).toBe(false)
    expect(isImageType(undefined)).toBe(false)
    expect(isImageType('')).toBe(false)
  })

  it('detects PDF media types', () => {
    expect(isPdfType('application/pdf')).toBe(true)
    expect(isPdfType('image/png')).toBe(false)
    expect(isPdfType(null)).toBe(false)
  })

  it('detects text media types used by the Electron file input flow', () => {
    expect(isTextType('text/plain')).toBe(true)
    expect(isTextType('text/markdown')).toBe(true)
    expect(isTextType('application/json')).toBe(true)
    expect(isTextType('application/pdf')).toBe(false)
    expect(isTextType(null)).toBe(false)
  })
})

describe('toDataUrl', () => {
  it('builds data URLs from media type and base64 content', () => {
    expect(toDataUrl('image/png', 'abc123')).toBe('data:image/png;base64,abc123')
    expect(toDataUrl('application/pdf', 'JVBER')).toBe('data:application/pdf;base64,JVBER')
  })

  it('builds text data URLs with unicode-safe base64', () => {
    expect(textToDataUrl('text/markdown', '# Hello')).toBe('data:text/markdown;base64,IyBIZWxsbw==')
    expect(textToDataUrl('text/plain', 'München')).toBe('data:text/plain;base64,TcO8bmNoZW4=')
  })
})

describe('toFileUIParts', () => {
  it('converts data URL attachments to AI SDK file parts', () => {
    const attachments = [
      { filename: 'photo.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,abc' },
      { filename: 'doc.pdf', mediaType: 'application/pdf', dataUrl: 'data:application/pdf;base64,xyz' },
    ]

    expect(toFileUIParts(attachments)).toEqual([
      { type: 'file', mediaType: 'image/png', filename: 'photo.png', url: 'data:image/png;base64,abc' },
      { type: 'file', mediaType: 'application/pdf', filename: 'doc.pdf', url: 'data:application/pdf;base64,xyz' },
    ])
  })

  it('does not convert text attachments to AI SDK file parts', () => {
    expect(toFileUIParts([
      { filename: 'notes.md', mediaType: 'text/markdown', content: '# Notes' },
    ])).toEqual([])
  })

  it('drops text attachments and attachments without usable file data', () => {
    expect(toFileUIParts([
      { filename: 'draft.txt', content: '' },
      { filename: 'empty.bin', mediaType: 'application/octet-stream' },
      null,
    ])).toEqual([])
  })

  it('returns an empty array for empty or non-array input', () => {
    expect(toFileUIParts([])).toEqual([])
    expect(toFileUIParts(undefined)).toEqual([])
    expect(toFileUIParts(null)).toEqual([])
  })
})

describe('toContextUIParts', () => {
  it('converts text attachments to structured data-context parts', () => {
    expect(toContextUIParts([
      { filename: 'notes.md', path: 'docs/notes.md', mediaType: 'text/markdown', content: '# Notes', size: 7 },
    ])).toEqual([
      {
        type: 'data-context',
        data: {
          filename: 'notes.md',
          path: 'docs/notes.md',
          mediaType: 'text/markdown',
          content: '# Notes',
          size: 7,
        },
      },
    ])
  })

  it('drops attachments without text content', () => {
    expect(toContextUIParts([
      { filename: 'photo.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,abc' },
      null,
    ])).toEqual([])
  })

  it('preserves comments context metadata', () => {
    const threads = [{ id: 'k3f9', anchor: 'text', notes: [] }]
    expect(toContextUIParts([
      {
        filename: 'Comments: plan.md (1)',
        mediaType: 'application/vnd.mim.comments+json',
        content: '{"path":"docs/plan.md","threads":[]}',
        kind: 'comments',
        path: 'docs/plan.md',
        threads,
      },
    ])).toEqual([
      {
        type: 'data-context',
        data: {
          filename: 'Comments: plan.md (1)',
          mediaType: 'application/vnd.mim.comments+json',
          content: '{"path":"docs/plan.md","threads":[]}',
          kind: 'comments',
          path: 'docs/plan.md',
          threads,
        },
      },
    ])
  })
})

describe('toUserMessageParts', () => {
  it('keeps text attachments as hidden structured context parts', () => {
    expect(toUserMessageParts('Summarize this.', [
      { filename: 'notes.md', mediaType: 'text/markdown', content: '# Notes' },
    ])).toEqual([
      {
        type: 'data-context',
        data: {
          filename: 'notes.md',
          mediaType: 'text/markdown',
          content: '# Notes',
        },
      },
      {
        type: 'text',
        text: 'Summarize this.',
      },
    ])
  })

  it('keeps image and PDF attachments as file parts', () => {
    expect(toUserMessageParts('Look at these.', [
      { filename: 'photo.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,abc' },
      { filename: 'doc.pdf', mediaType: 'application/pdf', dataUrl: 'data:application/pdf;base64,xyz' },
    ])).toEqual([
      { type: 'file', mediaType: 'image/png', filename: 'photo.png', url: 'data:image/png;base64,abc' },
      { type: 'file', mediaType: 'application/pdf', filename: 'doc.pdf', url: 'data:application/pdf;base64,xyz' },
      { type: 'text', text: 'Look at these.' },
    ])
  })
})

describe('validateFileSize', () => {
  it('returns true for files at or under 20MB', () => {
    expect(validateFileSize(1024)).toBe(true)
    expect(validateFileSize(10 * 1024 * 1024)).toBe(true)
    expect(validateFileSize(20 * 1024 * 1024)).toBe(true)
  })

  it('returns false for files over 20MB or invalid sizes', () => {
    expect(validateFileSize(20 * 1024 * 1024 + 1)).toBe(false)
    expect(validateFileSize(100 * 1024 * 1024)).toBe(false)
    expect(validateFileSize(Number.NaN)).toBe(false)
    expect(validateFileSize(Number.POSITIVE_INFINITY)).toBe(false)
    expect(validateFileSize(-1)).toBe(false)
  })
})

describe('isAttachmentPlaceholder', () => {
  it('returns true for placeholder objects', () => {
    expect(isAttachmentPlaceholder({ _attachmentPlaceholder: true, filename: 'a.png', mediaType: 'image/png' })).toBe(true)
  })

  it('returns false for regular file parts and nullish values', () => {
    expect(isAttachmentPlaceholder({ type: 'file', mediaType: 'image/png', url: 'data:...' })).toBe(false)
    expect(isAttachmentPlaceholder(null)).toBe(false)
    expect(isAttachmentPlaceholder(undefined)).toBe(false)
  })
})
