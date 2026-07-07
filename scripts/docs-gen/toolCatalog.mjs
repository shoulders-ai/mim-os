// Tool catalog generator.
// Boots the headless tool registry (requires `npm run build`) and emits
// manual/develop/tools.md with every registered tool grouped by namespace.
// Effect and approval data is parsed from the gate.ts source file directly
// (the Electron build bundles everything, so individual modules are not
// importable from a plain Node script).

import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Load the tool list by running `bin/mim.mjs list-tools --json`.
 * Returns an array of { name, description }.
 */
export function loadToolList() {
  const raw = execFileSync(process.execPath, [resolve(ROOT, 'bin/mim.mjs'), 'list-tools', '--json'], {
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  const parsed = JSON.parse(raw)
  return parsed.tools.map(t => ({ name: t.name, description: t.description }))
}

/**
 * Parse TOOL_POLICIES from gate.ts source. Returns a Map of name -> { category, risk }.
 */
export function parseToolPolicies(gateSource) {
  const policies = new Map()
  // Match lines like: 'fs.read': { category: 'read', risk: 'low', ... }
  const policyRegex = /'([^']+)':\s*\{\s*category:\s*'([^']+)',\s*risk:\s*'([^']+)'/g
  let m
  while ((m = policyRegex.exec(gateSource)) !== null) {
    policies.set(m[1], { category: m[2], risk: m[3] })
  }
  return policies
}

/**
 * Parse EFFECT_OVERRIDES from gate.ts source. Returns a Map of name -> effect.
 */
export function parseEffectOverrides(gateSource) {
  const overrides = new Map()
  // Find the EFFECT_OVERRIDES block
  const blockMatch = gateSource.match(/const EFFECT_OVERRIDES[^{]*\{([^}]+)\}/)
  if (!blockMatch) return overrides
  const block = blockMatch[1]
  const entryRegex = /'([^']+)':\s*'([^']+)'/g
  let m
  while ((m = entryRegex.exec(block)) !== null) {
    overrides.set(m[1], m[2])
  }
  return overrides
}

/**
 * Derive the effect for a category, matching the logic in gate.ts categoryEffect().
 */
export function categoryEffect(category) {
  switch (category) {
    case 'read':
    case 'search':
    case 'ai':
      return 'read'
    case 'network':
      return 'external'
    default:
      return 'mutate'
  }
}

/**
 * Build a gate-compatible module from parsed source data.
 * Returns { toolEffect, getToolPolicy }.
 */
export function buildGateModule(gateSource) {
  const policies = parseToolPolicies(gateSource)
  const overrides = parseEffectOverrides(gateSource)

  function getToolPolicy(name) {
    return policies.get(name) ?? { category: 'general', risk: 'low' }
  }

  function toolEffect(name) {
    if (overrides.has(name)) return overrides.get(name)
    const policy = getToolPolicy(name)
    return categoryEffect(policy.category)
  }

  return { toolEffect, getToolPolicy }
}

/**
 * Load the gate module by parsing gate.ts source.
 */
export function loadGateModule() {
  const gatePath = resolve(ROOT, 'src/main/security/gate.ts')
  const source = readFileSync(gatePath, 'utf-8')
  return buildGateModule(source)
}

/**
 * Derive effect and approval default for a tool.
 */
export function deriveToolMeta(name, gateModule) {
  const effect = gateModule.toolEffect(name)
  const policy = gateModule.getToolPolicy(name)
  // Approval default:
  // - read: auto-approved
  // - mutate: requires approval
  // - external: requires approval
  const approvalDefault = effect === 'read' ? 'auto' : 'ask'
  return { effect, category: policy.category, risk: policy.risk, approvalDefault }
}

/**
 * Group tools by namespace (the part before the first dot).
 * Tools without a dot go into a "core" group.
 */
export function groupByNamespace(tools) {
  const groups = new Map()
  for (const tool of tools) {
    const dotIdx = tool.name.indexOf('.')
    const ns = dotIdx > 0 ? tool.name.slice(0, dotIdx) : 'core'
    if (!groups.has(ns)) groups.set(ns, [])
    groups.get(ns).push(tool)
  }
  return groups
}

/**
 * Format effect for markdown output.
 * "mutate" is bolded per the design guide: "only **mutate** is bold ink".
 */
export function formatEffect(effect) {
  if (effect === 'mutate') return '**mutate**'
  return effect
}

/**
 * Generate the full markdown for manual/develop/tools.md.
 */
export function generateToolCatalogMarkdown(tools, gateModule) {
  const lines = [
    '---',
    'id: tools',
    'title: tool catalog',
    'generated: true',
    '---',
    '',
    '# tool catalog',
    '',
    'Every tool registered in the Mim tool registry. Effect determines the approval',
    'behavior: read tools are auto-approved, mutate and external tools require your',
    'approval.',
    '',
  ]

  const groups = groupByNamespace(tools)
  const sortedNs = [...groups.keys()].sort()

  for (const ns of sortedNs) {
    const nsTools = groups.get(ns)
    lines.push(`## ${ns}`)
    lines.push('')
    lines.push('| tool | description | effect | approval |')
    lines.push('|---|---|---|---|')
    for (const tool of nsTools) {
      const meta = deriveToolMeta(tool.name, gateModule)
      const desc = tool.description.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120)
      lines.push(`| \`${tool.name}\` | ${desc} | ${formatEffect(meta.effect)} | ${meta.approvalDefault} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Main entry point: generate and write the tool catalog.
 */
export function generateToolCatalog() {
  const tools = loadToolList()
  const gateModule = loadGateModule()
  const markdown = generateToolCatalogMarkdown(tools, gateModule)
  const outPath = resolve(ROOT, 'manual/develop/tools.md')
  writeFileSync(outPath, markdown, 'utf-8')
  return { path: outPath, toolCount: tools.length }
}
