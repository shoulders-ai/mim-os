// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { CAPTURE_RENDERED_HTML_SCRIPT, captureRenderedDocument } from './renderedCapture.js'

describe('captureRenderedDocument', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    document.title = ''
    window.history.replaceState({}, '', '/start')
  })

  it('serializes only visible rendered content and preserves safe attributes', () => {
    document.body.innerHTML = `
      <main data-framework="noise">
        <h1>Visible Title</h1>
        <p aria-label="Lead">A <a href="/docs" title="Docs">relative link</a>.</p>
        <img src="/hero.png" alt="Hero">
        <div hidden>Hidden attribute</div>
        <div style="display: none">Hidden display</div>
        <div style="visibility: hidden">Hidden visibility</div>
        <script>window.__STATE__ = { huge: true }</script>
      </main>
    `

    const capture = captureRenderedDocument()

    expect(capture.html).toContain('<h1>Visible Title</h1>')
    expect(capture.html).toContain('<p aria-label="Lead">A <a href="http://localhost:3000/docs" title="Docs">relative link</a>.</p>')
    expect(capture.html).toContain('<img src="http://localhost:3000/hero.png" alt="Hero" />')
    expect(capture.html).not.toContain('data-framework')
    expect(capture.html).not.toContain('Hidden attribute')
    expect(capture.html).not.toContain('Hidden display')
    expect(capture.html).not.toContain('Hidden visibility')
    expect(capture.html).not.toContain('__STATE__')
    expect(capture.signals).toMatchObject({
      link_count: 1,
      heading_count: 1,
      image_count: 1,
    })
    expect(capture.signals.visible_text_chars).toBeGreaterThan(20)
  })

  it('includes open shadow roots and same-origin iframe bodies', () => {
    const host = document.createElement('article')
    host.innerHTML = '<h1>Main host</h1>'
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow article body</p>'
    document.body.append(host)

    const frame = document.createElement('iframe')
    document.body.append(frame)
    const frameDoc = frame.contentDocument
    if (!frameDoc) throw new Error('happy-dom iframe contentDocument missing')
    frameDoc.title = 'Embedded Report'
    frameDoc.body.innerHTML = '<section><h2>Report</h2><p>Frame body.</p></section>'

    const capture = captureRenderedDocument()

    expect(capture.html).toContain('<h2>Shadow DOM</h2><p>Shadow article body</p>')
    expect(capture.html).toContain('<h2>Frame: Embedded Report</h2>')
    expect(capture.html).toContain('<p>Frame body.</p>')
  })

  it('exports a browser-executable script built from the tested capture function', () => {
    document.title = 'Hydrated'
    document.body.innerHTML = '<main><h1>Runtime DOM</h1></main>'

    const capture = (0, eval)(CAPTURE_RENDERED_HTML_SCRIPT) as ReturnType<typeof captureRenderedDocument>

    expect(capture).toEqual({
      title: 'Hydrated',
      html: '<body><main><h1>Runtime DOM</h1></main></body>',
      signals: {
        visible_text_chars: 11,
        link_count: 0,
        button_count: 0,
        form_control_count: 0,
        table_row_count: 0,
        heading_count: 1,
        image_count: 0,
      },
    })
  })
})
