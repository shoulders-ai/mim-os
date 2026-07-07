import { describe, expect, it } from 'vitest'
import {
  parseCodeRunCard,
  type CodeRunCardVM,
} from './chatCodeRunCard.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-bash',
    state: 'output-available',
    input: { command: 'Rscript analysis/fit.R', timeout_ms: 120000 },
    output: {
      exitCode: 0,
      timedOut: false,
      durationMs: 3421,
      stdout: 'Model fitted.\n',
      stderr: '',
      products: [],
      runId: 'run-abc',
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseCodeRunCard', () => {
  // -- command line --
  it('uses the command string as the displayable command line', () => {
    const vm = parseCodeRunCard(makePart())
    expect(vm.argvLine).toBe('Rscript analysis/fit.R')
  })

  it('returns a placeholder when input is missing or malformed', () => {
    const vm = parseCodeRunCard(makePart({ input: null }))
    expect(vm.argvLine).toBe('bash')
  })

  it('returns a placeholder when command is empty', () => {
    const vm = parseCodeRunCard(makePart({ input: { command: '' } }))
    expect(vm.argvLine).toBe('bash')
  })

  it('returns a placeholder when command is missing or non-string', () => {
    const vm = parseCodeRunCard(makePart({ input: { command: 42 } }))
    expect(vm.argvLine).toBe('bash')
  })

  // -- status --
  it('returns "ok" when exitCode is 0', () => {
    const vm = parseCodeRunCard(makePart())
    expect(vm.status).toBe('ok')
  })

  it('returns "failed" for non-zero exitCode', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 1, timedOut: false, durationMs: 500, stdout: '', stderr: 'Error', products: [], runId: 'x' },
    }))
    expect(vm.status).toBe('failed')
  })

  it('returns "timed-out" when timedOut is true', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: null, timedOut: true, durationMs: 120000, stdout: '', stderr: '', products: [], runId: 'x' },
    }))
    expect(vm.status).toBe('timed-out')
  })

  it('returns "running" for input-streaming state', () => {
    const vm = parseCodeRunCard(makePart({ state: 'input-streaming', output: undefined }))
    expect(vm.status).toBe('running')
  })

  it('returns "running" for input-available state (no output yet)', () => {
    const vm = parseCodeRunCard(makePart({ state: 'input-available', output: undefined }))
    expect(vm.status).toBe('running')
  })

  it('returns "error" for output-error state / errorText', () => {
    const vm = parseCodeRunCard(makePart({ state: 'error', errorText: 'tool crashed', output: undefined }))
    expect(vm.status).toBe('error')
  })

  it('returns "error" when errorText is present regardless of state', () => {
    const vm = parseCodeRunCard(makePart({ state: 'output-available', errorText: 'boom' }))
    expect(vm.status).toBe('error')
  })

  // -- duration label --
  it('formats duration under a minute as Xs', () => {
    const vm = parseCodeRunCard(makePart())
    expect(vm.durationLabel).toBe('3.4s')
  })

  it('formats duration over a minute as Xm Ys', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 0, timedOut: false, durationMs: 125400, stdout: '', stderr: '', products: [], runId: 'x' },
    }))
    expect(vm.durationLabel).toBe('2m 5s')
  })

  it('returns empty duration when still running', () => {
    const vm = parseCodeRunCard(makePart({ state: 'input-streaming', output: undefined }))
    expect(vm.durationLabel).toBe('')
  })

  it('returns empty duration for zero ms', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 0, timedOut: false, durationMs: 0, stdout: '', stderr: '', products: [], runId: 'x' },
    }))
    expect(vm.durationLabel).toBe('')
  })

  // -- output text --
  it('returns stdout when stderr is empty', () => {
    const vm = parseCodeRunCard(makePart())
    expect(vm.outputText).toBe('Model fitted.\n')
  })

  it('combines stdout and stderr with a separator', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 1, timedOut: false, durationMs: 100, stdout: 'partial output', stderr: 'Warning: something', products: [], runId: 'x' },
    }))
    expect(vm.outputText).toContain('partial output')
    expect(vm.outputText).toContain('Warning: something')
    expect(vm.outputText).toContain('stderr')
  })

  it('returns only stderr when stdout is empty', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 0, timedOut: false, durationMs: 100, stdout: '', stderr: 'warn', products: [], runId: 'x' },
    }))
    expect(vm.outputText).toBe('warn')
  })

  it('returns errorText when present', () => {
    const vm = parseCodeRunCard(makePart({ state: 'error', errorText: 'tool not found', output: undefined }))
    expect(vm.outputText).toBe('tool not found')
  })

  it('returns empty string when output and errorText are both missing', () => {
    const vm = parseCodeRunCard(makePart({ state: 'input-streaming', output: undefined }))
    expect(vm.outputText).toBe('')
  })

  // -- truncated --
  it('detects truncation marker in stdout', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 0, timedOut: false, durationMs: 100, stdout: '[…truncated 5000 chars]actual output', stderr: '', products: [], runId: 'x' },
    }))
    expect(vm.truncated).toBe(true)
  })

  it('detects truncation marker in stderr', () => {
    const vm = parseCodeRunCard(makePart({
      output: { exitCode: 0, timedOut: false, durationMs: 100, stdout: '', stderr: '[…truncated 1000 chars]error text', products: [], runId: 'x' },
    }))
    expect(vm.truncated).toBe(true)
  })

  it('reports not truncated when no marker', () => {
    const vm = parseCodeRunCard(makePart())
    expect(vm.truncated).toBe(false)
  })

  // -- products --
  it('maps products with basename, kind, sizeLabel', () => {
    const vm = parseCodeRunCard(makePart({
      output: {
        exitCode: 0, timedOut: false, durationMs: 100, stdout: '', stderr: '',
        products: [
          { path: '/workspace/.mim/code-runs/abc/plot-01.png', bytes: 48230, kind: 'image' },
          { path: '/workspace/output/report.pdf', bytes: 1048576, kind: 'pdf' },
        ],
        runId: 'x',
      },
    }))
    expect(vm.products).toHaveLength(2)
    expect(vm.products[0]).toEqual({
      path: '/workspace/.mim/code-runs/abc/plot-01.png',
      basename: 'plot-01.png',
      kind: 'image',
      sizeLabel: '47.1 KB',
    })
    expect(vm.products[1]).toEqual({
      path: '/workspace/output/report.pdf',
      basename: 'report.pdf',
      kind: 'pdf',
      sizeLabel: '1.0 MB',
    })
  })

  it('returns empty products when none present', () => {
    const vm = parseCodeRunCard(makePart())
    expect(vm.products).toEqual([])
  })

  it('handles products with missing/malformed fields', () => {
    const vm = parseCodeRunCard(makePart({
      output: {
        exitCode: 0, timedOut: false, durationMs: 100, stdout: '', stderr: '',
        products: [
          { path: '', bytes: null, kind: undefined },
          { path: 'file.txt' },
        ],
        runId: 'x',
      },
    }))
    expect(vm.products).toHaveLength(2)
    expect(vm.products[0].basename).toBe('')
    expect(vm.products[0].sizeLabel).toBe('')
    expect(vm.products[0].kind).toBe('other')
    expect(vm.products[1].basename).toBe('file.txt')
    expect(vm.products[1].kind).toBe('other')
  })

  // -- products with tiny/large sizes --
  it('formats bytes correctly', () => {
    const vm = parseCodeRunCard(makePart({
      output: {
        exitCode: 0, timedOut: false, durationMs: 100, stdout: '', stderr: '',
        products: [
          { path: 'a.txt', bytes: 0, kind: 'text' },
          { path: 'b.txt', bytes: 512, kind: 'text' },
          { path: 'c.bin', bytes: 10485760, kind: 'other' },
        ],
        runId: 'x',
      },
    }))
    expect(vm.products[0].sizeLabel).toBe('0 B')
    expect(vm.products[1].sizeLabel).toBe('512 B')
    expect(vm.products[2].sizeLabel).toBe('10.0 MB')
  })

  // -- fully malformed part --
  it('never throws on a completely empty part', () => {
    const vm = parseCodeRunCard({})
    expect(vm.argvLine).toBe('bash')
    expect(vm.status).toBe('running')
    expect(vm.durationLabel).toBe('')
    expect(vm.outputText).toBe('')
    expect(vm.products).toEqual([])
    expect(vm.truncated).toBe(false)
  })

  it('never throws when output is a string instead of object', () => {
    const vm = parseCodeRunCard(makePart({ output: 'unexpected string' }))
    expect(vm.status).toBe('running') // cannot determine success/failure
    expect(vm.outputText).toBe('')
  })
})
