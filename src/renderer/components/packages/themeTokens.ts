export const THEME_TOKEN_NAMES = [
  '--color-ink',
  '--color-ink-2',
  '--color-ink-3',
  '--color-ink-4',
  '--color-chrome',
  '--color-chrome-mid',
  '--color-chrome-high',
  '--color-surface',
  '--color-accent',
  '--color-accent-soft',
  '--color-accent-ink',
  '--color-accent-tint',
  '--color-rule',
  '--color-rule-light',
  '--color-line-soft',
  '--color-add',
  '--color-rem',
  '--font-sans',
  '--font-serif',
  '--font-mono',
  '--font-brand',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--space-xs',
  '--space-sm',
  '--space-md',
  '--space-lg',
] as const

export function readThemeTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  for (const name of THEME_TOKEN_NAMES) {
    const val = style.getPropertyValue(name).trim()
    if (val) tokens[name] = val
  }
  return tokens
}
