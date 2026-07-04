// Pure view-model for the code_run tool card. All functions are side-effect
// free and never throw — malformed inputs degrade gracefully.

export interface CodeRunProduct {
  path: string
  basename: string
  kind: 'image' | 'pdf' | 'table' | 'html' | 'text' | 'other'
  sizeLabel: string
}

export interface CodeRunCardVM {
  argvLine: string
  status: 'running' | 'ok' | 'failed' | 'timed-out' | 'error'
  durationLabel: string
  outputText: string
  truncated: boolean
  products: CodeRunProduct[]
}

const TRUNCATION_MARKER_RE = /\[…truncated \d+ chars\]/

const VALID_KINDS = new Set(['image', 'pdf', 'table', 'html', 'text', 'other'])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseCodeRunCard(part: Record<string, unknown>): CodeRunCardVM {
  const input = isRecord(part.input) ? part.input : null
  const output = isRecord(part.output) ? part.output : null
  const errorText = typeof part.errorText === 'string' ? part.errorText : ''
  const state = typeof part.state === 'string' ? part.state : ''

  return {
    argvLine: buildArgvLine(input),
    status: resolveStatus(state, errorText, output),
    durationLabel: buildDurationLabel(output),
    outputText: buildOutputText(output, errorText),
    truncated: detectTruncation(output),
    products: buildProducts(output),
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildArgvLine(input: Record<string, unknown> | null): string {
  if (!input) return 'code_run'
  const argv = input.argv
  if (!Array.isArray(argv) || argv.length === 0) return 'code_run'
  const line = argv.map(String).join(' ')
  return line || 'code_run'
}

function resolveStatus(
  state: string,
  errorText: string,
  output: Record<string, unknown> | null,
): CodeRunCardVM['status'] {
  if (errorText) return 'error'
  if (state === 'error') return 'error'

  if (!output) return 'running'

  if (output.timedOut === true) return 'timed-out'
  if (typeof output.exitCode === 'number') {
    return output.exitCode === 0 ? 'ok' : 'failed'
  }
  // exitCode is null (killed) but not timed out — treat as failed
  if ('exitCode' in output && output.exitCode === null && !output.timedOut) return 'failed'

  return 'running'
}

function buildDurationLabel(output: Record<string, unknown> | null): string {
  if (!output) return ''
  const ms = output.durationMs
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return ''

  if (ms < 60000) {
    const seconds = ms / 1000
    return `${seconds.toFixed(1)}s`
  }

  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (seconds === 0) return `${minutes}m`
  return `${minutes}m ${seconds}s`
}

function buildOutputText(output: Record<string, unknown> | null, errorText: string): string {
  if (errorText) return errorText
  if (!output) return ''

  const stdout = typeof output.stdout === 'string' ? output.stdout : ''
  const stderr = typeof output.stderr === 'string' ? output.stderr : ''

  if (stdout && stderr) {
    return `${stdout}\n--- stderr ---\n${stderr}`
  }
  return stdout || stderr
}

function detectTruncation(output: Record<string, unknown> | null): boolean {
  if (!output) return false
  const stdout = typeof output.stdout === 'string' ? output.stdout : ''
  const stderr = typeof output.stderr === 'string' ? output.stderr : ''
  return TRUNCATION_MARKER_RE.test(stdout) || TRUNCATION_MARKER_RE.test(stderr)
}

function buildProducts(output: Record<string, unknown> | null): CodeRunProduct[] {
  if (!output) return []
  const raw = output.products
  if (!Array.isArray(raw)) return []

  return raw.map((item) => {
    if (!isRecord(item)) return fallbackProduct()
    const path = typeof item.path === 'string' ? item.path : ''
    const basename = path ? path.split('/').pop() || path : ''
    const kind = typeof item.kind === 'string' && VALID_KINDS.has(item.kind)
      ? item.kind as CodeRunProduct['kind']
      : 'other'
    const bytes = typeof item.bytes === 'number' && Number.isFinite(item.bytes) ? item.bytes : null
    return { path, basename, kind, sizeLabel: formatBytes(bytes) }
  })
}

function fallbackProduct(): CodeRunProduct {
  return { path: '', basename: '', kind: 'other', sizeLabel: '' }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes < 0) return ''
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
