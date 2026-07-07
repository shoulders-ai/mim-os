// Models page generator.
// Reads resources/ai-models.json and emits manual/develop/models.md
// with provider sections and model tables.

import { readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Load the models catalog from resources/ai-models.json.
 */
export function loadModelsCatalog() {
  const raw = readFileSync(resolve(ROOT, 'resources/ai-models.json'), 'utf-8')
  return JSON.parse(raw)
}

/**
 * Group models by their provider field.
 */
export function groupModelsByProvider(models) {
  const groups = new Map()
  for (const model of models) {
    const provider = model.provider
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider).push(model)
  }
  return groups
}

/**
 * Format a context window number as a human-readable string.
 */
export function formatContextWindow(tokens) {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`
  if (tokens >= 1_000) return `${tokens / 1_000}K`
  return String(tokens)
}

/**
 * Format pricing as a string.
 */
export function formatPricing(pricing) {
  if (!pricing) return '-'
  return `$${pricing.inputPerMillion}/$${pricing.outputPerMillion}`
}

/**
 * Format capabilities as a comma-separated string of supported features.
 */
export function formatCapabilities(caps) {
  if (!caps) return '-'
  const supported = Object.entries(caps)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
  return supported.join(', ')
}

/**
 * Generate the markdown for manual/develop/models.md.
 */
export function generateModelsMarkdown(catalog) {
  const lines = [
    '---',
    'id: models',
    'title: models',
    'generated: true',
    '---',
    '',
    '# models',
    '',
    'Models available in Mim, grouped by provider. Pricing is per million tokens',
    '(input/output).',
    '',
  ]

  // Providers section
  lines.push('## providers')
  lines.push('')
  lines.push('| provider | api endpoint | key env var |')
  lines.push('|---|---|---|')
  for (const [id, config] of Object.entries(catalog.providers)) {
    lines.push(`| ${id} | ${config.url} | \`${config.apiKeyEnv}\` |`)
  }
  lines.push('')

  // Defaults section
  lines.push('## defaults')
  lines.push('')
  lines.push('| role | models |')
  lines.push('|---|---|')
  for (const [role, models] of Object.entries(catalog.defaults)) {
    lines.push(`| ${role} | ${models.map(m => `\`${m}\``).join(', ')} |`)
  }
  lines.push('')

  // Models by provider
  const groups = groupModelsByProvider(catalog.models)
  for (const [provider, models] of groups) {
    const providerLabel = catalog.providers[provider]
      ? provider.charAt(0).toUpperCase() + provider.slice(1)
      : provider
    lines.push(`## ${providerLabel.toLowerCase()}`)
    lines.push('')
    lines.push('| model | context | pricing (in/out) | capabilities | control |')
    lines.push('|---|---|---|---|---|')
    for (const m of models) {
      const name = m.displayName || m.name
      const ctx = formatContextWindow(m.contextWindow)
      const pricing = formatPricing(m.pricing)
      const caps = formatCapabilities(m.capabilities)
      const control = m.control ? `${m.control.kind} (${m.control.default})` : '-'
      lines.push(`| ${name} | ${ctx} | ${pricing} | ${caps} | ${control} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Main entry point: generate and write the models page.
 */
export function generateModels() {
  const catalog = loadModelsCatalog()
  const markdown = generateModelsMarkdown(catalog)
  const outPath = resolve(ROOT, 'manual/develop/models.md')
  writeFileSync(outPath, markdown, 'utf-8')
  return { path: outPath, modelCount: catalog.models.length }
}
