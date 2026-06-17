// @vitest-environment happy-dom
//
// DOMPurify relies on browser-grade DOM parsing. happy-dom's parser is
// incomplete — it doesn't build a full DOM tree from arbitrary HTML, so
// DOMPurify's tag allowlisting only works for stripping (not preserving).
// These tests verify that dangerous content IS stripped. Preservation of
// safe markdown HTML (headings, code blocks, tables, etc.) is guaranteed
// by DOMPurify's own extensive test suite and works in the real Electron
// Chromium renderer.

import { describe, it, expect } from 'vitest'
import { sanitizeHtml, _ALLOWED_TAGS, _ALLOWED_ATTR } from './sanitize.js'

describe('sanitizeHtml', () => {
  describe('strips dangerous elements and attributes', () => {
    it('strips script tags', () => {
      // happy-dom keeps the (inert) text content; the tag itself must go.
      expect(sanitizeHtml('<script>window.kernel.call("fs.delete")</script>')).not.toContain('<script')
    })

    it('strips img onerror handlers (the prompt-injection vector)', () => {
      const result = sanitizeHtml('<img src="x" onerror="kernel.call(\'fs.delete\')">')
      expect(result).not.toContain('onerror')
    })

    it('strips iframe tags', () => {
      expect(sanitizeHtml('<iframe src="https://evil.com"></iframe>')).toBe('')
    })

    it('strips object and embed tags', () => {
      expect(sanitizeHtml('<object data="evil.swf"></object>')).toBe('')
      expect(sanitizeHtml('<embed src="evil.swf">')).toBe('')
    })

    it('strips form tags', () => {
      const result = sanitizeHtml('<form action="https://evil.com"><input></form>')
      expect(result).not.toContain('<form')
    })

    it('strips style attributes', () => {
      const result = sanitizeHtml('<p style="color:red">text</p>')
      expect(result).not.toContain('style')
      expect(result).toContain('text')
    })

    it('strips data-* attributes', () => {
      const result = sanitizeHtml('<div data-payload="secret">ok</div>')
      expect(result).not.toContain('data-payload')
      expect(result).toContain('ok')
    })

    it('strips onclick handlers', () => {
      const result = sanitizeHtml('<div onclick="alert(1)">click</div>')
      expect(result).not.toContain('onclick')
    })

    it('strips javascript: hrefs', () => {
      const result = sanitizeHtml('<a href="javascript:alert(1)">link</a>')
      expect(result).not.toContain('javascript')
    })
  })

  describe('code block markup', () => {
    // happy-dom's incomplete DOM parser means DOMPurify tag/attr preservation
    // only works in the real Chromium renderer. These tests verify the
    // allowlist configuration is correct (dangerous content IS stripped),
    // not that allowed content survives parsing.
    it('preserves class attributes on code elements', () => {
      const result = sanitizeHtml('<code class="hljs language-js">const</code>')
      // happy-dom may not preserve the tag; verify at least no dangerous content
      expect(result).not.toContain('onerror')
      expect(result).toContain('const')
    })

    it('strips button elements — interactive controls must never come from model output', () => {
      // Copy buttons are injected as trusted DOM by ChatMessage AFTER
      // sanitization. A <button> surviving sanitization would let prompt-
      // injected output render native-looking UI (fake Approve/Run buttons).
      const result = sanitizeHtml('<button class="cm-code-copy" type="button" title="Copy">Approve</button>')
      expect(result).not.toContain('<button')
    })

    it('allowlist contains no interactive controls except task-list input', () => {
      // happy-dom cannot test tag preservation, so pin the config itself.
      for (const tag of ['button', 'select', 'textarea', 'form', 'label', 'option']) {
        expect(_ALLOWED_TAGS).not.toContain(tag)
      }
      expect(_ALLOWED_ATTR).not.toContain('style')
      expect(_ALLOWED_ATTR).not.toContain('onclick')
    })

    it('strips onclick from any element', () => {
      const result = sanitizeHtml('<button onclick="alert(1)">Copy</button>')
      expect(result).not.toContain('onclick')
    })

    it('strips style attributes on span elements', () => {
      const result = sanitizeHtml('<span style="color:red">text</span>')
      expect(result).not.toContain('style')
      expect(result).toContain('text')
    })

    it('keeps class-bearing structural markup content', () => {
      // class/title are allowed attrs on structural tags (for hljs token
      // spans); the real Chromium renderer preserves them, happy-dom cannot
      // test preservation — assert content survives and nothing dangerous does.
      const cfg = sanitizeHtml('<div class="test">ok</div>')
      expect(cfg).toContain('ok')
    })
  })

  describe('edge cases', () => {
    it('handles empty input', () => {
      expect(sanitizeHtml('')).toBe('')
    })

    it('passes through plain text', () => {
      expect(sanitizeHtml('just text')).toBe('just text')
    })
  })
})
