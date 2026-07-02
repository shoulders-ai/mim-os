// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIONABLE_REF_ATTRIBUTE,
  ACTIONABLE_REF_SCHEME,
  CAPTURE_MARKANYWHERE_PAGE_SCRIPT,
  captureMarkanywherePage,
  decodeActionableRefHref,
  encodeActionableRefHref,
} from './liveBrowserCapture.js'

describe('Markanywhere live browser capture port', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/start')
  })

  it('stamps dense document-order refs only on actionable elements', () => {
    document.title = 'Actionable'
    document.body.innerHTML = `
      <main>
        <h1>Actionable</h1>
        <a href="https://example.com/">a link</a>
        <input type="text" id="name" placeholder="name">
        <button type="button">Go</button>
        <span>just text, not actionable</span>
        <p id="out">idle</p>
      </main>
    `

    const capture = captureMarkanywherePage()

    expect(capture.refs.map(ref => ({
      ref: ref.ref,
      tag: ref.tag,
      label: ref.label,
    }))).toEqual([
      { ref: '1', tag: 'a', label: 'a link' },
      { ref: '2', tag: 'input', label: 'name' },
      { ref: '3', tag: 'button', label: 'Go' },
    ])
    expect(capture.markdown).toContain('[a link](ref:1:https://example.com/)')
    expect(capture.markdown).toContain('<input ref="2" type="text" placeholder="name" value="">')
    expect(capture.markdown).toContain('<button ref="3" type="button">Go</button>')
    expect(capture.markdown).toContain('just text, not actionable')
    expect(capture.markdown).not.toContain('ref="4"')
  })

  it('keeps disabled controls ref-addressable so actions can fail explicitly', () => {
    document.body.innerHTML = '<button disabled>Cannot submit</button>'

    const capture = captureMarkanywherePage()

    expect(capture.refs).toMatchObject([
      { ref: '1', tag: 'button', label: 'Cannot submit', disabled: true },
    ])
    expect(capture.markdown).toContain('<button ref="1" disabled>Cannot submit</button>')
  })

  it('drops hidden subtrees from the LLM-facing markdown', () => {
    document.body.innerHTML = `
      <main>
        <p>Visible</p>
        <p style="display: none">display hidden</p>
        <p style="visibility: hidden">visibility hidden</p>
        <p aria-hidden="true">aria hidden</p>
      </main>
    `

    const capture = captureMarkanywherePage()

    expect(capture.markdown).toContain('Visible')
    expect(capture.markdown).not.toContain('display hidden')
    expect(capture.markdown).not.toContain('visibility hidden')
    expect(capture.markdown).not.toContain('aria hidden')
  })

  it('encodes and decodes actionable link refs with the Markanywhere ref scheme', () => {
    const href = 'https://example.com:8080/path?q=1'
    const encoded = encodeActionableRefHref('42', href)

    expect(ACTIONABLE_REF_SCHEME).toBe('ref')
    expect(ACTIONABLE_REF_ATTRIBUTE).toBe('ref')
    expect(encoded).toBe(`ref:42:${href}`)
    expect(decodeActionableRefHref(encoded)).toEqual({ ref: '42', href })
    expect(decodeActionableRefHref('https://example.com')).toBeNull()
    expect(decodeActionableRefHref('ref:42')).toBeNull()
  })

  it('exports a browser-executable script built from the tested capture function', () => {
    document.title = 'Hydrated'
    document.body.innerHTML = '<main><h1>Runtime DOM</h1><button>Act</button></main>'

    const capture = (0, eval)(CAPTURE_MARKANYWHERE_PAGE_SCRIPT) as ReturnType<typeof captureMarkanywherePage>

    expect(capture.title).toBe('Hydrated')
    expect(capture.markdown).toContain('# Runtime DOM')
    expect(capture.refs).toMatchObject([{ ref: '1', tag: 'button', label: 'Act' }])
  })
})
