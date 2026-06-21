import { mkdirSync, writeFileSync, rmSync, existsSync, promises as fs, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, resolve, normalize } from 'path'
import { pathToFileURL } from 'url'
import { parse as parseYaml } from 'yaml'
import type { ToolRegistry } from '@main/tools/registry.js'
import type { PackageLoader } from '@main/packages/packages.js'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'
import {
  isValidCapabilityId,
  isValidPublicToolName,
  matchesToolGrant,
  parsePackageManifest,
  resolveInsidePackage,
  type MimPackageManifest,
} from '@main/packages/packageManifest.js'

export interface PackageToolReloadDeps {
  invalidate?: (packageId?: string) => void
  syncNamedTools?: () => Promise<void>
  emit?: (channel: string, payload?: unknown) => void
}

export function registerPackageTools(
  tools: ToolRegistry,
  packages: PackageLoader,
  enablement?: PackageEnablementStore,
  reloadDeps: PackageToolReloadDeps = {},
): void {

  tools.register({
    name: 'package.create',
    description: 'Create a new app in the workspace',
    inputSchema: objectSchema({
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      icon: { type: 'string' },
      html: { type: 'string' },
      js: { type: 'string' },
      backend: { type: 'string' },
      skill: {},
      skills: { type: 'array' },
      readme: { type: 'string' },
      permissions: { type: 'object' },
      provides: { type: 'object' },
      dataFolder: { type: 'string' },
      views: { type: 'array' },
      override: { type: 'boolean' },
    }, ['id', 'name']),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const id = requireString(params, 'id')
      const name = requireString(params, 'name')
      const description = optionalString(params, 'description') ?? ''
      const icon = optionalString(params, 'icon')
      const html = optionalString(params, 'html')
      const js = optionalString(params, 'js')
      const backend = optionalString(params, 'backend')
      const readme = optionalString(params, 'readme')
      const skills = skillInputs(params, id)
      const permissions = optionalObject(params, 'permissions')
      const provides = optionalObject(params, 'provides')
      const dataFolder = optionalString(params, 'dataFolder')
      const views = packageViews(params, name, html)
      const override = params.override === true

      validatePackageId(id)

      if (!override) {
        const existing = packages.get(id)
        if (existing && existing.source === 'global') {
          throw new Error(
            `App "${id}" already exists as a ${existing.source} app. ` +
            `Pass override: true to create a workspace override.`,
          )
        }
      }

      const pkgDir = join(workspace, 'packages', id)
      if (existsSync(pkgDir)) {
        throw new Error(`App already exists: ${id}`)
      }

      mkdirSync(pkgDir, { recursive: true })

      const manifest = {
        name: `@mim/${id}`,
        version: '0.1.0',
        type: 'module',
        mim: {
          manifestVersion: 1,
          id,
          name,
          description,
          icon,
          views,
          ...(backend ? { backend: './backend/index.mjs' } : {}),
          permissions: permissions ?? {},
          ...(provides ? { provides } : {}),
          ...(dataFolder ? { dataFolder } : {}),
          engines: { mim: 'runtime-v1' },
        },
      }
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2))
      const written = ['package.json']

      if (html !== undefined) {
        const uiDir = join(pkgDir, 'ui')
        mkdirSync(uiDir, { recursive: true })
        writeFileSync(join(uiDir, 'index.html'), html)
        written.push('ui/index.html')
      }

      if (js) {
        const uiDir = join(pkgDir, 'ui')
        mkdirSync(uiDir, { recursive: true })
        writeFileSync(join(uiDir, 'app.js'), js)
        written.push('ui/app.js')
      }

      if (backend !== undefined) {
        const backendPath = join(pkgDir, 'backend', 'index.mjs')
        mkdirSync(dirname(backendPath), { recursive: true })
        writeFileSync(backendPath, backend)
        written.push('backend/index.mjs')
      }

      for (const skill of skills) {
        const skillPath = join(pkgDir, 'skills', skill.name, 'SKILL.md')
        mkdirSync(dirname(skillPath), { recursive: true })
        writeFileSync(skillPath, skill.content)
        written.push(`skills/${skill.name}/SKILL.md`)
      }

      if (readme !== undefined) {
        writeFileSync(join(pkgDir, 'README.md'), readme)
        written.push('README.md')
      }

      return { created: id, path: pkgDir, files: written }
    }
  })

  tools.register({
    name: 'package.edit',
    description: 'Edit a file within an existing app',
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const id = requireString(params, 'id')
      const file = requireString(params, 'file')
      const content = requireString(params, 'content')

      validatePackageId(id)
      const pkgDir = join(workspace, 'packages', id)
      if (!existsSync(pkgDir)) {
        throw new Error(`App not found: ${id}`)
      }

      // Resolve and validate path stays within the app directory
      const target = resolve(pkgDir, normalize(file))
      if (!target.startsWith(pkgDir + '/') && target !== pkgDir) {
        throw new Error('Path traversal outside app directory is not allowed')
      }

      // Ensure parent dir exists
      const parentDir = target.substring(0, target.lastIndexOf('/'))
      mkdirSync(parentDir, { recursive: true })

      writeFileSync(target, content, 'utf-8')
      return { edited: file }
    }
  })

  tools.register({
    name: 'package.delete',
    description: 'Delete an app from the workspace',
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const id = requireString(params, 'id')

      validatePackageId(id)
      const pkgDir = join(workspace, 'packages', id)
      if (!existsSync(pkgDir)) {
        throw new Error(`App not found: ${id}`)
      }

      rmSync(pkgDir, { recursive: true, force: true })
      return { deleted: id }
    }
  })

  tools.register({
    name: 'package.readme',
    description: 'Read the app-root README.md for an installed app',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async (params) => {
      const id = requireString(params, 'id')
      validatePackageId(id)
      const pkg = packages.get(id)
      if (!pkg) throw new Error(`App not found: ${id}`)

      const readmePath = resolveInsidePackage(pkg.dir, 'README.md')
      if (!readmePath) throw new Error(`App README not found: ${id}`)

      let stat
      try {
        stat = await fs.lstat(readmePath)
      } catch {
        throw new Error(`App README not found: ${id}`)
      }
      if (!stat.isFile()) {
        throw new Error(`App README is not a regular file: ${id}`)
      }

      const content = await fs.readFile(readmePath, 'utf-8')
      return { id, name: pkg.manifest.name, content }
    }
  })

  tools.register({
    name: 'package.validate',
    description: 'Validate a workspace app before or after reload',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const id = requireString(params, 'id')
      validatePackageId(id)
      return validateWorkspacePackage(workspace, id)
    },
  })

  tools.register({
    name: 'package.reload',
    description: 'Rescan apps, invalidate app runtime caches, and re-register named app tools',
    inputSchema: objectSchema({ id: { type: 'string' } }),
    execute: async (params) => {
      requireWorkspace(tools)
      const id = optionalString(params, 'id')
      if (id) validatePackageId(id)

      await packages.rescan()
      reloadDeps.invalidate?.(id)
      await reloadDeps.syncNamedTools?.()

      const payload = {
        packages: packageListPayload(packages, enablement),
        diagnostics: packages.diagnostics(),
      }
      reloadDeps.emit?.('packages:changed', packages.list())
      reloadDeps.emit?.('apps:changed', {})
      return { reloaded: id ?? null, ...payload }
    },
  })

  tools.register({
    name: 'package.list',
    description: 'List all installed apps',
    execute: async () => {
      return {
        packages: packageListPayload(packages, enablement),
        diagnostics: packages.diagnostics(),
      }
    }
  })
}

function requireWorkspace(tools: ToolRegistry): string {
  const ws = tools.getWorkspacePath()
  if (!ws) throw new Error('No workspace open')
  return ws
}

function requireString(params: Record<string, unknown>, key: string): string {
  const val = params[key]
  if (typeof val !== 'string' || val.length === 0) {
    throw new Error(`Missing required parameter: ${key}`)
  }
  return val
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const val = params[key]
  if (val === undefined) return undefined
  if (typeof val !== 'string') throw new Error(`Parameter ${key} must be a string`)
  return val
}

function optionalObject(params: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const val = params[key]
  if (val === undefined) return undefined
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`Parameter ${key} must be an object`)
  }
  return val as Record<string, unknown>
}

function packageViews(params: Record<string, unknown>, label: string, html: string | undefined) {
  const raw = params.views
  if (raw === undefined) {
    return html === undefined
      ? []
      : [{ id: 'main', label, src: './ui/index.html', role: 'work' }]
  }
  if (!Array.isArray(raw)) throw new Error('Parameter views must be an array')
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`views[${index}] must be an object`)
    }
    const view = item as Record<string, unknown>
    const id = typeof view.id === 'string' ? view.id : ''
    const viewLabel = typeof view.label === 'string' ? view.label : ''
    const src = typeof view.src === 'string' ? view.src : ''
    const role = typeof view.role === 'string' ? view.role : ''
    if (!id || !viewLabel || !src) throw new Error(`views[${index}] requires id, label, and src`)
    if (role !== 'work' && role !== 'artifact' && role !== 'either') {
      throw new Error(`views[${index}].role must be work, artifact, or either`)
    }
    return { id, label: viewLabel, src, role }
  })
}

function skillInputs(params: Record<string, unknown>, defaultName: string): Array<{ name: string; content: string }> {
  const result: Array<{ name: string; content: string }> = []
  const single = params.skill
  if (typeof single === 'string') {
    result.push({ name: defaultName, content: single })
  } else if (single && typeof single === 'object' && !Array.isArray(single)) {
    const skill = single as Record<string, unknown>
    if (typeof skill.name !== 'string' || typeof skill.content !== 'string') {
      throw new Error('Parameter skill must be a string or { name, content }')
    }
    result.push({ name: skill.name, content: skill.content })
  } else if (single !== undefined) {
    throw new Error('Parameter skill must be a string or { name, content }')
  }

  const many = params.skills
  if (many !== undefined) {
    if (!Array.isArray(many)) throw new Error('Parameter skills must be an array')
    for (const [index, item] of many.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`skills[${index}] must be an object`)
      }
      const skill = item as Record<string, unknown>
      if (typeof skill.name !== 'string' || typeof skill.content !== 'string') {
        throw new Error(`skills[${index}] requires name and content`)
      }
      result.push({ name: skill.name, content: skill.content })
    }
  }

  for (const skill of result) validateSkillName(skill.name)
  return result
}

function validateSkillName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(`Invalid skill name: ${name}`)
  }
}

function packageListPayload(packages: PackageLoader, enablement?: PackageEnablementStore) {
  return packages.list().map(p => ({
    id: p.manifest.id,
    name: p.manifest.name,
    icon: p.manifest.icon,
    description: p.manifest.description,
    version: p.manifest.version,
    views: p.manifest.views,
    backend: p.manifest.backend,
    permissions: p.manifest.permissions,
    enabled: enablement?.isEnabled(p) ?? true,
    source: p.source,
    hasReadme: p.hasReadme === true,
  }))
}

interface ValidationDiagnostic {
  path: string
  message: string
}

interface ValidationSummary {
  tools: number
  jobs: number
  skills: number
  namedTools: number
}

async function validateWorkspacePackage(workspace: string, id: string): Promise<{
  id: string
  path: string
  valid: boolean
  errors: ValidationDiagnostic[]
  warnings: ValidationDiagnostic[]
  summary: ValidationSummary
}> {
  const pkgDir = join(workspace, 'packages', id)
  const errors: ValidationDiagnostic[] = []
  const warnings: ValidationDiagnostic[] = []
  const summary: ValidationSummary = { tools: 0, jobs: 0, skills: 0, namedTools: 0 }

  const addError = (path: string, message: string) => errors.push({ path, message })
  const addWarning = (path: string, message: string) => warnings.push({ path, message })

  if (!existsSync(pkgDir)) {
    addError(pkgDir, `App directory not found: ${id}`)
    return { id, path: pkgDir, valid: false, errors, warnings, summary }
  }

  const manifestPath = join(pkgDir, 'package.json')
  let packageJson: Record<string, unknown>
  try {
    packageJson = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    addError(manifestPath, `Could not read package.json: ${(err as Error).message}`)
    return { id, path: pkgDir, valid: false, errors, warnings, summary }
  }

  const parsed = parsePackageManifest(packageJson, pkgDir)
  for (const diagnostic of parsed.diagnostics) {
    const target = diagnostic.path || manifestPath
    if (parsed.manifest) addWarning(target, diagnostic.message)
    else addError(target, diagnostic.message)
  }
  const manifest = parsed.manifest
  if (!manifest) {
    summary.skills = validatePackageSkills(pkgDir, errors, warnings)
    return { id, path: pkgDir, valid: false, errors, warnings, summary }
  }

  if (manifest.id !== id) {
    addError(manifestPath, `mim.id "${manifest.id}" must match app folder "${id}"`)
  }

  summary.skills = validatePackageSkills(pkgDir, errors, warnings)

  if (manifest.backend) {
    const backendPath = resolveInsidePackage(pkgDir, manifest.backend)
    if (!backendPath) {
      addError(manifestPath, 'Backend path escapes app directory')
    } else {
      try {
        const mod = await import(`${pathToFileURL(backendPath).href}?mimValidate=${Date.now()}`) as Record<string, unknown>
        validateBackendExports({ pkgDir, backendPath, manifest, mod, errors, warnings, summary })
        validatePermissionHints({ backendPath, manifest, warnings })
      } catch (err) {
        addError(backendPath, `Failed to import backend: ${(err as Error).message}`)
      }
    }
  } else if ((manifest.provides?.tools.length ?? 0) > 0) {
    addWarning(manifestPath, 'mim.provides.tools is declared but no backend is configured')
  }

  return { id, path: pkgDir, valid: errors.length === 0, errors, warnings, summary }
}

function validateBackendExports(input: {
  pkgDir: string
  backendPath: string
  manifest: MimPackageManifest
  mod: Record<string, unknown>
  errors: ValidationDiagnostic[]
  warnings: ValidationDiagnostic[]
  summary: ValidationSummary
}): void {
  validateBackendJobs(input)
  validateBackendTools(input)
  if (input.mod.agentContext !== undefined && typeof input.mod.agentContext !== 'function') {
    input.errors.push({ path: input.backendPath, message: 'backend export "agentContext" must be a function' })
  }
}

function validateBackendJobs(input: {
  backendPath: string
  mod: Record<string, unknown>
  errors: ValidationDiagnostic[]
  summary: ValidationSummary
}): void {
  const raw = input.mod.jobs
  if (raw == null) return
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    input.errors.push({ path: input.backendPath, message: 'backend export "jobs" must be an object' })
    return
  }
  for (const [jobId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidCapabilityId(jobId)) {
      input.errors.push({ path: input.backendPath, message: `Invalid job id: ${jobId}` })
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      input.errors.push({ path: input.backendPath, message: `Job ${jobId} must be an object` })
      continue
    }
    if (typeof (value as Record<string, unknown>).run !== 'function') {
      input.errors.push({ path: input.backendPath, message: `Job ${jobId} must export run(ctx, input)` })
      continue
    }
    input.summary.jobs += 1
  }
}

function validateBackendTools(input: {
  backendPath: string
  manifest: MimPackageManifest
  mod: Record<string, unknown>
  errors: ValidationDiagnostic[]
  warnings: ValidationDiagnostic[]
  summary: ValidationSummary
}): void {
  const raw = input.mod.tools
  const grants = input.manifest.provides?.tools ?? []
  const namedTools = new Set<string>()
  if (raw == null) {
    for (const grant of grants) {
      input.warnings.push({ path: input.backendPath, message: `mim.provides.tools grant "${grant.pattern}" does not match any backend named tool` })
    }
    return
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    input.errors.push({ path: input.backendPath, message: 'backend export "tools" must be an object' })
    return
  }

  for (const [toolId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidCapabilityId(toolId)) {
      input.errors.push({ path: input.backendPath, message: `Invalid tool id: ${toolId}` })
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      input.errors.push({ path: input.backendPath, message: `Tool ${toolId} must be an object` })
      continue
    }
    const tool = value as Record<string, unknown>
    if (typeof tool.execute !== 'function') {
      input.errors.push({ path: input.backendPath, message: `Tool ${toolId} must export execute(ctx, input)` })
      continue
    }
    if (typeof tool.description !== 'string' || tool.description.length === 0) {
      input.errors.push({ path: input.backendPath, message: `Tool ${toolId} needs a description` })
      continue
    }
    input.summary.tools += 1

    if (typeof tool.name === 'string') {
      if (!isValidPublicToolName(tool.name)) {
        input.errors.push({ path: input.backendPath, message: `Tool ${toolId}: invalid public name "${tool.name}"` })
        continue
      }
      if (!grants.some(grant => matchesToolGrant(grant.pattern, tool.name as string))) {
        input.errors.push({ path: input.backendPath, message: `Tool ${toolId}: name "${tool.name}" is not granted by manifest provides.tools` })
        continue
      }
      namedTools.add(tool.name)
      input.summary.namedTools += 1
    }
  }

  for (const grant of grants) {
    if (![...namedTools].some(name => matchesToolGrant(grant.pattern, name))) {
      input.warnings.push({ path: input.backendPath, message: `mim.provides.tools grant "${grant.pattern}" does not match any backend named tool` })
    }
  }
}

function validatePermissionHints(input: {
  backendPath: string
  manifest: MimPackageManifest
  warnings: ValidationDiagnostic[]
}): void {
  let source = ''
  try {
    source = readFileSync(input.backendPath, 'utf-8')
  } catch {
    return
  }
  const p = input.manifest.permissions
  const warn = (message: string) => input.warnings.push({ path: input.backendPath, message })
  if (/\bctx\.http\b/.test(source) && (p.http?.length ?? 0) === 0) {
    warn('Backend appears to use ctx.http but mim.permissions.http is empty')
  }
  if (/\bctx\.secrets\b/.test(source) && (p.secrets?.length ?? 0) === 0) {
    warn('Backend appears to use ctx.secrets but mim.permissions.secrets is empty')
  }
  if (/\bctx\.ai\b/.test(source) && p.ai !== true) {
    warn('Backend appears to use ctx.ai but mim.permissions.ai is not true')
  }
  if (/(readWorkspaceText|['"]fs\.read['"]|['"]fs\.list['"]|documents\.)/.test(source) && p.workspace?.read !== true) {
    warn('Backend appears to read workspace files but mim.permissions.workspace.read is not true')
  }
  if (/(['"]fs\.(write|edit|create|delete|trash|copy|rename)['"]|writeWorkspace)/.test(source) && p.workspace?.write !== true) {
    warn('Backend appears to write workspace files but mim.permissions.workspace.write is not true')
  }
}

function validatePackageSkills(
  pkgDir: string,
  errors: ValidationDiagnostic[],
  warnings: ValidationDiagnostic[],
): number {
  const skillsDir = join(pkgDir, 'skills')
  if (!existsSync(skillsDir)) return 0
  let count = 0
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsDir, entry.name)
    const skillPath = join(skillDir, 'SKILL.md')
    if (!existsSync(skillPath)) {
      warnings.push({ path: skillDir, message: 'Skill directory has no SKILL.md' })
      continue
    }
    try {
      if (!statSync(skillPath).isFile()) {
        errors.push({ path: skillPath, message: 'SKILL.md is not a regular file' })
        continue
      }
      const raw = readFileSync(skillPath, 'utf-8')
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
      if (!match) {
        errors.push({ path: skillPath, message: 'SKILL.md must start with YAML frontmatter' })
        continue
      }
      let frontmatter: unknown
      try {
        frontmatter = parseYaml(match[1])
      } catch (err) {
        errors.push({ path: skillPath, message: `Invalid YAML frontmatter: ${(err as Error).message}` })
        continue
      }
      if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
        errors.push({ path: skillPath, message: 'SKILL.md frontmatter must be an object' })
        continue
      }
      const meta = frontmatter as Record<string, unknown>
      const name = typeof meta.name === 'string' ? meta.name.trim() : ''
      const description = typeof meta.description === 'string' ? meta.description.trim() : ''
      if (!name) errors.push({ path: skillPath, message: 'Skill frontmatter requires name' })
      if (name && name !== entry.name) errors.push({ path: skillPath, message: 'Skill name must match folder name' })
      if (!description) errors.push({ path: skillPath, message: 'Skill frontmatter requires description' })
      if (name && name === entry.name && description) count += 1
      if (meta.tools !== undefined && !Array.isArray(meta.tools)) {
        warnings.push({ path: skillPath, message: 'Skill frontmatter tools should be an array' })
      }
      if (meta.unlocks !== undefined && !Array.isArray(meta.unlocks)) {
        warnings.push({ path: skillPath, message: 'Skill frontmatter unlocks should be an array' })
      }
    } catch (err) {
      errors.push({ path: skillPath, message: `Could not validate skill: ${(err as Error).message}` })
    }
  }
  return count
}

function validatePackageId(id: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    throw new Error('Invalid app id: must be lowercase alphanumeric, hyphens, underscores')
  }
  if (id.includes('..') || id.includes('/')) {
    throw new Error('Invalid app id')
  }
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}
