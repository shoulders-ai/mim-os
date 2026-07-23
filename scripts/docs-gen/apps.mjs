// Apps page generator.
// Reads mim-apps manifests and README files and emits manual/develop/apps.md.
// Sources: MIM_APPS_PATH env override, then well-known local checkouts. If no
// source is found, warns and exits 0 — does not fail the whole generation.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Find the mim-apps packages directory.
 * Returns the path to the packages/ directory, or null if not found.
 */
export function findMimAppsPath() {
  // 1. MIM_APPS_PATH env override
  if (process.env.MIM_APPS_PATH) {
    const p = resolve(process.env.MIM_APPS_PATH, 'packages')
    if (existsSync(p)) return p
    // Maybe the env points directly to the packages dir
    if (existsSync(join(process.env.MIM_APPS_PATH, 'package.json'))) {
      return process.env.MIM_APPS_PATH
    }
    // Try as-is if it contains package dirs
    const envPath = process.env.MIM_APPS_PATH
    if (existsSync(envPath) && hasPackageDirs(envPath)) return envPath
  }

  // 2. Well-known local locations
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = [
    join(home, 'Desktop/mim-apps/packages'),
    join(home, 'Desktop/mims/mim-apps/packages'),
    join(home, 'Desktop/shoulders-ai/mim-apps/packages'),
  ]
  for (const p of candidates) {
    if (existsSync(p) && hasPackageDirs(p)) return p
  }

  return null
}

function hasPackageDirs(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    return entries.some(e => e.isDirectory() && existsSync(join(dir, e.name, 'package.json')))
  } catch {
    return false
  }
}

/**
 * Load app manifests from the packages directory.
 * Returns array of { id, name, description, version, readme }.
 */
export function loadAppManifests(packagesDir) {
  const apps = []
  const entries = readdirSync(packagesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    const pkgPath = join(packagesDir, entry.name, 'package.json')
    if (!existsSync(pkgPath)) continue

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const manifest = pkg.mim ?? {}
      const readmePath = join(packagesDir, entry.name, 'README.md')
      const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : null

      apps.push({
        id: manifest.id ?? entry.name,
        name: manifest.name ?? pkg.name ?? entry.name,
        description: manifest.description ?? pkg.description ?? '',
        version: pkg.version ?? '0.0.0',
        readme,
        views: manifest.views ?? [],
        provides: manifest.provides ?? {},
        permissions: manifest.permissions ?? {},
      })
    } catch {
      // Skip malformed packages
    }
  }

  return apps
}

/**
 * Generate the markdown for manual/develop/apps.md.
 */
export function generateAppsMarkdown(apps) {
  const lines = [
    '---',
    'id: apps',
    'title: apps',
    'generated: true',
    '---',
    '',
    '# apps',
    '',
    'Apps maintained in the Mim app catalog.',
    '',
    '| app | description | version |',
    '|---|---|---|',
  ]

  for (const app of apps) {
    const desc = app.description.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${app.name} | ${desc} | ${app.version} |`)
  }
  lines.push('')

  // Per-app detail sections
  for (const app of apps) {
    lines.push(`## ${app.name.toLowerCase()}`)
    lines.push('')
    if (app.description) {
      lines.push(app.description)
      lines.push('')
    }

    // Views
    if (app.views.length > 0) {
      lines.push('**views:**')
      for (const v of app.views) {
        lines.push(`- ${v.label ?? v.id} (${v.role ?? 'work'})`)
      }
      lines.push('')
    }

    // Named tools
    const tools = app.provides?.tools ?? []
    if (tools.length > 0) {
      lines.push('**named tools:**')
      for (const t of tools) {
        lines.push(`- \`${t.name}\``)
      }
      lines.push('')
    }

    // README excerpt (first paragraph)
    if (app.readme) {
      const firstParagraph = extractFirstParagraph(app.readme)
      if (firstParagraph) {
        lines.push(firstParagraph)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

/**
 * Extract the first real paragraph from a README (skip headings and blank lines).
 */
export function extractFirstParagraph(readme) {
  const lines = readme.split('\n')
  const paragraphLines = []
  let inParagraph = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (inParagraph) break
      continue
    }
    if (trimmed.startsWith('#')) {
      if (inParagraph) break
      continue
    }
    inParagraph = true
    paragraphLines.push(trimmed)
  }

  return paragraphLines.join(' ').slice(0, 300) || null
}

/**
 * Main entry point: generate and write the apps page.
 */
export function generateApps() {
  const packagesDir = findMimAppsPath()
  if (!packagesDir) {
    console.warn('docs-gen: mim-apps not found — skipping apps.md generation.')
    console.warn('  Set MIM_APPS_PATH to a mim-apps checkout, or clone to ~/Desktop/mim-apps.')
    return { path: null, appCount: 0, skipped: true }
  }

  const apps = loadAppManifests(packagesDir)
  const markdown = generateAppsMarkdown(apps)
  const outPath = resolve(ROOT, 'manual/develop/apps.md')
  writeFileSync(outPath, markdown, 'utf-8')
  return { path: outPath, appCount: apps.length, skipped: false }
}
