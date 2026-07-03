import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname2 = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(__dirname2, 'styles.css'), 'utf8')

// ── Helpers ──────────────────────────────────────────────────────────

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
function luminance(hex: string): number {
  const c = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i =>
    srgbToLinear(parseInt(c.slice(i, i + 2), 16) / 255),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// ── CSS parser ───────────────────────────────────────────────────────

type Tokens = Record<string, string>

const TOKEN_KEYS = [
  'ink', 'ink-2', 'ink-3', 'ink-4',
  'chrome', 'chrome-mid', 'chrome-high', 'surface',
  'accent', 'rule', 'rule-light',
] as const

function parseThemeBlock(block: string): Tokens {
  const tokens: Tokens = {}
  for (const key of TOKEN_KEYS) {
    const re = new RegExp(`--color-${key}\\s*:\\s*(#[0-9a-fA-F]{6})`)
    const m = block.match(re)
    if (m) tokens[key] = m[1].toLowerCase()
  }
  return tokens
}

function parseTheme(name: string): Tokens {
  const re = new RegExp(
    `:root\\[data-theme="${name}"\\]\\s*\\{([^}]+)\\}`,
  )
  const m = css.match(re)
  if (!m) throw new Error(`theme "${name}" not found`)
  return parseThemeBlock(m[1])
}

function parseDefaults(): Tokens {
  const m = css.match(/@theme\s*\{([\s\S]*?)\n\}/)
  if (!m) throw new Error('@theme block not found')
  return parseThemeBlock(m[1])
}

// ── Contrast contract ────────────────────────────────────────────────
//
// Floors are WCAG 2.1 minimums for how each token is used:
//   ink    — primary body text (AA normal = 4.5, we require well above)
//   ink-2  — secondary text    (AA normal)
//   ink-3  — muted labels, icons (AA normal)
//   ink-4  — metadata, disabled (AA large-text / UI components = 3.0)
//   accent — bold labels, icons (AA large-text / UI components = 3.0)
//   chrome vs surface — structural separation (perceptible step)
//   rule/rule-light — divider visibility against adjacent surfaces

const ALL_BGS = ['chrome', 'chrome-mid', 'chrome-high', 'surface'] as const

const TEXT_CONTRACT: Array<{
  fg: string
  bgs: readonly string[]
  floor: number
}> = [
  { fg: 'ink',    bgs: ALL_BGS, floor: 8.0 },
  { fg: 'ink-2',  bgs: ALL_BGS, floor: 5.5 },
  { fg: 'ink-3',  bgs: ALL_BGS, floor: 4.5 },
  { fg: 'ink-4',  bgs: ALL_BGS, floor: 3.0 },
  { fg: 'accent', bgs: ALL_BGS, floor: 3.0 },
]

const THEMES = [
  'parchment', 'glacier', 'white', 'sage',
  'slate', 'monokai', 'nord', 'dracula',
] as const

describe('theme contrast contract', () => {
  const defaults = parseDefaults()

  it('@theme defaults parse all tokens', () => {
    for (const key of TOKEN_KEYS) {
      expect(defaults[key], `missing default for ${key}`).toBeDefined()
    }
  })

  for (const name of THEMES) {
    describe(name, () => {
      const t = parseTheme(name)

      for (const { fg, bgs, floor } of TEXT_CONTRACT) {
        for (const bg of bgs) {
          it(`${fg} on ${bg} ≥ ${floor}`, () => {
            const r = contrast(t[fg], t[bg])
            expect(r, `${fg} ${t[fg]} on ${bg} ${t[bg]}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(floor)
          })
        }
      }

      it('chrome vs surface ≥ 1.25', () => {
        const r = contrast(t['chrome'], t['surface'])
        expect(r, `chrome ${t['chrome']} vs surface ${t['surface']}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.25)
      })

      it('chrome vs chrome-high ≥ 1.10', () => {
        const r = contrast(t['chrome'], t['chrome-high'])
        expect(r, `chrome ${t['chrome']} vs chrome-high ${t['chrome-high']}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.10)
      })

      it('rule-light visible against chrome ≥ 1.25', () => {
        const r = contrast(t['rule-light'], t['chrome'])
        expect(r, `rule-light ${t['rule-light']} vs chrome ${t['chrome']}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.25)
      })

      it('rule-light visible against surface ≥ 1.25', () => {
        const r = contrast(t['rule-light'], t['surface'])
        expect(r, `rule-light ${t['rule-light']} vs surface ${t['surface']}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.25)
      })

      it('rule visible against chrome ≥ 1.40', () => {
        const r = contrast(t['rule'], t['chrome'])
        expect(r, `rule ${t['rule']} vs chrome ${t['chrome']}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.40)
      })

      it('rule visible against surface ≥ 1.40', () => {
        const r = contrast(t['rule'], t['surface'])
        expect(r, `rule ${t['rule']} vs surface ${t['surface']}: ${r.toFixed(2)}`).toBeGreaterThanOrEqual(1.40)
      })
    })
  }
})
