import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MAX_ATTACHMENT_BYTES, mediaTypeFromPath, readAttachmentPath } from '@main/attachments.js'

describe('main attachment reader', () => {
  it('detects supported media types from paths', () => {
    expect(mediaTypeFromPath('photo.PNG')).toBe('image/png')
    expect(mediaTypeFromPath('notes.md')).toBe('text/markdown')
    expect(mediaTypeFromPath('data.json')).toBe('application/json')
    expect(mediaTypeFromPath('archive.bin')).toBe(null)
  })

  it('reads text attachments as utf-8 content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-attachment-test-'))
    try {
      const path = join(dir, 'notes.md')
      writeFileSync(path, '# Notes\nhello', 'utf-8')

      expect(readAttachmentPath(path)).toEqual({
        filename: 'notes.md',
        mediaType: 'text/markdown',
        size: 13,
        type: 'text',
        content: '# Notes\nhello',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads image and binary attachments as data URLs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-attachment-test-'))
    try {
      const imagePath = join(dir, 'pixel.png')
      const binaryPath = join(dir, 'blob.bin')
      writeFileSync(imagePath, Buffer.from([0, 1, 2, 3]))
      writeFileSync(binaryPath, Buffer.from([4, 5, 6]))

      expect(readAttachmentPath(imagePath)).toMatchObject({
        filename: 'pixel.png',
        mediaType: 'image/png',
        size: 4,
        type: 'image',
        dataUrl: 'data:image/png;base64,AAECAw==',
      })
      expect(readAttachmentPath(binaryPath)).toMatchObject({
        filename: 'blob.bin',
        mediaType: 'application/octet-stream',
        size: 3,
        type: 'file',
        dataUrl: 'data:application/octet-stream;base64,BAUG',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects files over the attachment size cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-attachment-test-'))
    try {
      const path = join(dir, 'large.txt')
      writeFileSync(path, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))
      expect(() => readAttachmentPath(path)).toThrow('File too large')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
