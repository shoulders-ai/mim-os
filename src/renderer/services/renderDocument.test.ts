import { describe, expect, it } from 'vitest'
import {
  renderArgv,
  rmarkdownRenderExpression,
  escapeForRString,
  pickBestProduct,
  missingPdfEngineGuidance,
} from './renderDocument.js'

describe('escapeForRString', () => {
  it('escapes backslashes', () => {
    expect(escapeForRString('C:\\Users\\foo')).toBe("C:\\\\Users\\\\foo")
  })

  it('escapes single quotes', () => {
    expect(escapeForRString("file's name.Rmd")).toBe("file\\'s name.Rmd")
  })

  it('handles combined backslashes and quotes', () => {
    expect(escapeForRString("C:\\Users\\it's\\file.Rmd")).toBe("C:\\\\Users\\\\it\\'s\\\\file.Rmd")
  })

  it('leaves clean paths unchanged', () => {
    expect(escapeForRString('analysis/report.Rmd')).toBe('analysis/report.Rmd')
  })
})

describe('rmarkdownRenderExpression', () => {
  it('wraps path in rmarkdown::render with single-quote escaping', () => {
    expect(rmarkdownRenderExpression('report.Rmd')).toBe(
      "rmarkdown::render('report.Rmd')",
    )
  })

  it('escapes special characters in the path', () => {
    expect(rmarkdownRenderExpression("docs/it's here.Rmd")).toBe(
      "rmarkdown::render('docs/it\\'s here.Rmd')",
    )
  })

  it('escapes backslashes in Windows paths', () => {
    expect(rmarkdownRenderExpression('C:\\docs\\report.Rmd')).toBe(
      "rmarkdown::render('C:\\\\docs\\\\report.Rmd')",
    )
  })
})

describe('renderArgv', () => {
  describe('.qmd files', () => {
    it('uses quarto render when quarto is detected', () => {
      const result = renderArgv('report.qmd', { quarto: true, rscript: true })
      expect(result).toEqual(['quarto', 'render', 'report.qmd'])
    })

    it('returns null when quarto is not detected (qmd requires quarto)', () => {
      const result = renderArgv('report.qmd', { quarto: false, rscript: true })
      expect(result).toBeNull()
    })

    it('returns null when no engine detected for qmd', () => {
      const result = renderArgv('report.qmd', { quarto: false, rscript: false })
      expect(result).toBeNull()
    })
  })

  describe('.rmd files', () => {
    it('uses quarto render when quarto is detected', () => {
      const result = renderArgv('analysis.Rmd', { quarto: true, rscript: true })
      expect(result).toEqual(['quarto', 'render', 'analysis.Rmd'])
    })

    it('falls back to Rscript -e rmarkdown::render when quarto is absent', () => {
      const result = renderArgv('analysis.Rmd', { quarto: false, rscript: true })
      expect(result).toEqual(['rscript', '-e', "rmarkdown::render('analysis.Rmd')"])
    })

    it('escapes paths when using Rscript fallback', () => {
      const result = renderArgv("doc's file.Rmd", { quarto: false, rscript: true })
      expect(result).toEqual(['rscript', '-e', "rmarkdown::render('doc\\'s file.Rmd')"])
    })

    it('returns null when neither engine detected for rmd', () => {
      const result = renderArgv('report.rmd', { quarto: false, rscript: false })
      expect(result).toBeNull()
    })
  })

  describe('case insensitivity', () => {
    it('handles .QMD extension', () => {
      const result = renderArgv('REPORT.QMD', { quarto: true, rscript: false })
      expect(result).toEqual(['quarto', 'render', 'REPORT.QMD'])
    })

    it('handles .RMD extension', () => {
      const result = renderArgv('report.RMD', { quarto: true, rscript: true })
      expect(result).toEqual(['quarto', 'render', 'report.RMD'])
    })
  })

  describe('unsupported extensions', () => {
    it('returns null for .md files', () => {
      const result = renderArgv('notes.md', { quarto: true, rscript: true })
      expect(result).toBeNull()
    })

    it('returns null for .R files', () => {
      const result = renderArgv('script.R', { quarto: true, rscript: true })
      expect(result).toBeNull()
    })
  })
})

describe('pickBestProduct', () => {
  it('ranks pdf above html', () => {
    const products = [
      { path: 'out/report.html', bytes: 5000, kind: 'html' as const },
      { path: 'out/report.pdf', bytes: 8000, kind: 'pdf' as const },
    ]
    expect(pickBestProduct(products)).toEqual(products[1])
  })

  it('ranks html above other kinds', () => {
    const products = [
      { path: 'out/report.docx', bytes: 3000, kind: 'other' as const },
      { path: 'out/report.html', bytes: 5000, kind: 'html' as const },
    ]
    expect(pickBestProduct(products)).toEqual(products[1])
  })

  it('returns the first pdf when multiple exist', () => {
    const products = [
      { path: 'out/a.pdf', bytes: 1000, kind: 'pdf' as const },
      { path: 'out/b.pdf', bytes: 2000, kind: 'pdf' as const },
    ]
    expect(pickBestProduct(products)).toEqual(products[0])
  })

  it('returns null for empty array', () => {
    expect(pickBestProduct([])).toBeNull()
  })

  it('returns the only product when there is just one', () => {
    const products = [
      { path: 'out/report.docx', bytes: 3000, kind: 'other' as const },
    ]
    expect(pickBestProduct(products)).toEqual(products[0])
  })

  it('handles image products below pdf/html', () => {
    const products = [
      { path: 'plot.png', bytes: 1000, kind: 'image' as const },
      { path: 'report.html', bytes: 5000, kind: 'html' as const },
    ]
    expect(pickBestProduct(products)).toEqual(products[1])
  })
})

describe('missingPdfEngineGuidance', () => {
  const GUIDANCE = 'PDF engine missing — run `quarto install tinytex` or render to HTML'

  it('detects tinytex mention in stderr', () => {
    const stderr = 'Error: tinytex is not installed. Please install it first.'
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('detects "no latex" in stderr', () => {
    const stderr = 'Error: no LaTeX installation found\nPlease install TinyTeX'
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('detects xelatex not found', () => {
    const stderr = "Error in running:\n  xelatex was not found on the PATH"
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('detects xelatex not found (alternative phrasing)', () => {
    const stderr = "xelatex: not found"
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('detects pdflatex not found', () => {
    const stderr = "pdflatex: command not found\ncheck your PATH"
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('detects "no latex" (case insensitive)', () => {
    const stderr = 'No LaTeX Distribution Found'
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('detects lualatex not found', () => {
    const stderr = 'lualatex not found in PATH'
    expect(missingPdfEngineGuidance(stderr)).toBe(GUIDANCE)
  })

  it('returns null for unrelated errors', () => {
    const stderr = 'Error in library(ggplot2): there is no package called ggplot2'
    expect(missingPdfEngineGuidance(stderr)).toBeNull()
  })

  it('returns null for empty stderr', () => {
    expect(missingPdfEngineGuidance('')).toBeNull()
  })

  it('returns null for undefined/null-ish input', () => {
    expect(missingPdfEngineGuidance(undefined as unknown as string)).toBeNull()
  })
})
