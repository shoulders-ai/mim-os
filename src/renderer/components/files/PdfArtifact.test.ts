// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import PdfArtifact from './PdfArtifact.vue'

function mountPdf(props: { path: string; port: number }) {
  const appRoot = document.createElement('div')
  document.body.appendChild(appRoot)
  const app = createApp(PdfArtifact, props)
  app.mount(appRoot)
  return { app, root: appRoot }
}

describe('PdfArtifact', () => {
  let mounted: ReturnType<typeof mountPdf> | null = null

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('serves the PDF from the kernel server with each path segment encoded', () => {
    mounted = mountPdf({ path: 'docs/Q3 report #final.pdf', port: 4242 })

    const iframe = mounted.root.querySelector('iframe')!
    expect(iframe.getAttribute('src')).toBe(
      'http://127.0.0.1:4242/workspace-files/docs/Q3%20report%20%23final.pdf'
    )
    expect(iframe.getAttribute('title')).toBe('Q3 report #final.pdf')
  })

  it('shows a fallback instead of an iframe when no server port is available', () => {
    mounted = mountPdf({ path: 'docs/report.pdf', port: 0 })

    expect(mounted.root.querySelector('iframe')).toBeNull()
    expect(mounted.root.textContent).toContain('PDF viewer unavailable')
  })
})
