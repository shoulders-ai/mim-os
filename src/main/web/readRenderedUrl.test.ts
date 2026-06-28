import { describe, expect, it, vi } from 'vitest'
import { readRenderedUrl, type RenderedPageRenderer } from './readRenderedUrl.js'

function rendererReturning(html: string, extra: Partial<Awaited<ReturnType<RenderedPageRenderer>>> = {}): RenderedPageRenderer {
  return vi.fn(async ({ url }) => ({
    requestedUrl: url,
    finalUrl: extra.finalUrl ?? url,
    title: extra.title ?? 'Rendered Test',
    html,
    ...(extra.capture ? { capture: extra.capture } : {}),
  }))
}

describe('readRenderedUrl', () => {
  it('returns Markdown from rendered browser HTML with final URL and stats', async () => {
    const render = rendererReturning(`
      <html>
        <head><title>Static title</title></head>
        <body>
          <div id="app"><h1>Hydrated Title</h1><p>Client-rendered content.</p></div>
          <script>document.querySelector('#app').textContent = 'raw source should not win'</script>
        </body>
      </html>
    `, { finalUrl: 'https://example.com/final', title: 'Runtime Title' })

    const result = await readRenderedUrl({
      url: 'https://example.com/start',
      max_chars: 100_000,
    }, { render })

    expect(result.url).toBe('https://example.com/start')
    expect(result.final_url).toBe('https://example.com/final')
    expect(result.title).toBe('Runtime Title')
    expect(result.content).toContain('# Hydrated Title')
    expect(result.content).toContain('Client-rendered content.')
    expect(result.content).not.toContain('raw source should not win')
    expect(result.truncated).toBe(false)
    expect(result.next_start_char).toBeUndefined()
    expect(result.length).toBe(result.content.length)
    expect(result.stats.rendered_html_chars).toBeGreaterThan(0)
    expect(result.stats.markdown.finalMarkdownChars).toBe(result.length)
    expect(result.capture).toMatchObject({ status: 'complete', confidence: 'high' })
    expect(result.stats.capture).toMatchObject({ status: 'complete', confidence: 'high' })
    expect(render).toHaveBeenCalledWith({
      url: 'https://example.com/start',
      timeoutMs: 30_000,
    })
  })

  it('returns partial capture evidence without treating readable content as a hard failure', async () => {
    const render = rendererReturning('<body><main><h1>Quarterly report</h1><p>Revenue grew while the app was still hydrating.</p></main></body>', {
      capture: {
        status: 'partial',
        confidence: 'medium',
        reason: 'Capture budget ended while the DOM was still changing.',
        signals: {
          elapsed_ms: 30_000,
          timed_out: true,
          dom_stable: false,
          visible_text_chars: 72,
          link_count: 0,
          button_count: 0,
          form_control_count: 0,
          table_row_count: 0,
          heading_count: 1,
          image_count: 0,
        },
      },
    })

    const result = await readRenderedUrl({ url: 'https://example.com/report' }, { render })

    expect(result.content).toContain('# Quarterly report')
    expect(result.capture).toMatchObject({
      status: 'partial',
      confidence: 'medium',
      reason: 'Capture budget ended while the DOM was still changing.',
    })
    expect(result.stats.capture).toMatchObject({
      signals: expect.objectContaining({ timed_out: true, dom_stable: false }),
    })
  })

  it('strips hidden noise while preserving visible iframe and shadow capture markup', async () => {
    const render = rendererReturning(`
      <body>
        <p>Visible main content.</p>
        <div hidden>Hidden attribute</div>
        <div style="display:none">Hidden style</div>
        <section><h2>Shadow DOM</h2><p>Open shadow content.</p></section>
        <section><h2>Frame</h2><p>Same-origin iframe content.</p></section>
        <code id="state-json">{"payload":"${'x'.repeat(160)}"}</code>
      </body>
    `)

    const result = await readRenderedUrl({ url: 'https://example.com/app' }, { render })

    expect(result.content).toContain('Visible main content.')
    expect(result.content).toContain('Open shadow content.')
    expect(result.content).toContain('Same-origin iframe content.')
    expect(result.content).not.toContain('Hidden attribute')
    expect(result.content).not.toContain('Hidden style')
    expect(result.content).not.toContain('payload')
  })

  it('respects link and image extraction options', async () => {
    const html = `
      <body>
        <p>Read <a href="https://example.com/docs" title="Docs">docs</a>.</p>
        <table>
          <tr><th>Image</th><th>Name</th></tr>
          <tr><td><img src="https://cdn.example.com/widget.jpg" alt="Widget image"></td><td>Widget</td></tr>
        </table>
      </body>
    `

    const defaultResult = await readRenderedUrl({ url: 'https://example.com' }, { render: rendererReturning(html) })
    expect(defaultResult.content).toContain('Read docs.')
    expect(defaultResult.content).toContain('| Widget image | Widget |')
    expect(defaultResult.content).not.toContain('https://example.com/docs')
    expect(defaultResult.content).not.toContain('widget.jpg')

    const richResult = await readRenderedUrl({
      url: 'https://example.com',
      extract_links: true,
      extract_images: true,
    }, { render: rendererReturning(html) })
    expect(richResult.content).toContain('[docs](https://example.com/docs "Docs")')
    expect(richResult.content).toContain('widget.jpg')
  })

  it('returns structure-aware chunks with continuation offsets and table context', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => `<tr><td>Row ${i}</td><td>Value ${i}</td></tr>`).join('')
    const html = `<body><table><tr><th>Name</th><th>Value</th></tr>${rows}</table></body>`
    const first = await readRenderedUrl({ url: 'https://example.com/table', max_chars: 220 }, { render: rendererReturning(html) })

    expect(first.truncated).toBe(true)
    expect(first.next_start_char).toBeGreaterThan(0)
    expect(first.content).toContain('| Name | Value |')
    expect(first.content).toContain('| --- | --- |')

    const second = await readRenderedUrl({
      url: 'https://example.com/table',
      max_chars: 220,
      start_from_char: first.next_start_char,
    }, { render: rendererReturning(html) })

    expect(second.stats.started_from_char).toBe(first.next_start_char)
    expect(second.content).toContain('| Name | Value |')
    expect(second.content).toContain('| --- | --- |')
    expect(second.content).not.toBe(first.content)
  })

  it('rejects continuation offsets beyond the rendered markdown length', async () => {
    await expect(readRenderedUrl({
      url: 'https://example.com',
      start_from_char: 99_999,
    }, { render: rendererReturning('<body><p>Short</p></body>') }))
      .rejects.toThrow('start_from_char (99999) exceeds content length')
  })

  it('uses the same URL safety policy as raw web reads', async () => {
    const render = rendererReturning('<body><p>Never reached</p></body>')

    await expect(readRenderedUrl({ url: 'file:///etc/passwd' }, { render })).rejects.toThrow('http/https')
    await expect(readRenderedUrl({ url: 'http://127.0.0.1' }, { render })).rejects.toThrow('Blocked URL')
    await expect(readRenderedUrl({ url: 'http://localhost' }, { render })).rejects.toThrow('Blocked URL')
    expect(render).not.toHaveBeenCalled()
  })

  it('allows private addresses only through injected test/development policy', async () => {
    const render = rendererReturning('<body><p>Local fixture</p></body>')
    const result = await readRenderedUrl({ url: 'http://127.0.0.1/page' }, {
      render,
      allowPrivateAddresses: true,
    })

    expect(result.content).toBe('Local fixture')
  })

  it('fails clearly when the renderer times out without readable content', async () => {
    const render = vi.fn(async () => {
      throw new Error('Rendered read timed out after 30s')
    })

    await expect(readRenderedUrl({ url: 'https://example.com/slow' }, { render }))
      .rejects.toThrow('No readable content captured from https://example.com/slow')
  })

  it('fails clearly when a rendered page exposes no readable text', async () => {
    const render = rendererReturning('<body></body>', {
      finalUrl: 'https://www.reddit.com/',
      title: 'Reddit - Please wait for verification',
      capture: {
        status: 'complete',
        confidence: 'low',
        reason: 'The page stayed stable but exposed very little readable content.',
        signals: {
          elapsed_ms: 30_000,
          timed_out: false,
          dom_stable: true,
          visible_text_chars: 0,
          link_count: 0,
          button_count: 0,
          form_control_count: 0,
          table_row_count: 0,
          heading_count: 0,
          image_count: 0,
        },
      },
    })

    await expect(readRenderedUrl({ url: 'https://www.reddit.com/' }, { render }))
      .rejects.toThrow('title: Reddit - Please wait for verification')
  })

  it('retries a transient navigation failure once before extracting content', async () => {
    const render = vi.fn()
      .mockRejectedValueOnce(new Error('Execution context was destroyed, most likely because of a navigation.'))
      .mockResolvedValueOnce({
        requestedUrl: 'https://example.com/app',
        finalUrl: 'https://example.com/app',
        title: 'Recovered',
        html: '<body><h1>Recovered page</h1><p>Useful content after navigation settled.</p></body>',
      })

    const result = await readRenderedUrl({ url: 'https://example.com/app' }, { render })

    expect(result.content).toContain('# Recovered page')
    expect(result.stats.render_attempts).toBe(2)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-transient renderer failures', async () => {
    const render = vi.fn(async () => {
      throw new Error('Certificate revoked')
    })

    await expect(readRenderedUrl({ url: 'https://example.com/cert' }, { render }))
      .rejects.toThrow('Certificate revoked')
    expect(render).toHaveBeenCalledOnce()
  })
})
