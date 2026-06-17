import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { userHomeDir } from '@main/platform.js'

export type AuthoredSkillSource = 'builtin' | 'source' | 'personal' | 'workspace'
export type SkillSource = AuthoredSkillSource | 'package'

export interface SkillMetadata {
  id: string
  name: string
  description: string
  tools: string[]
  // tools listed in `unlocks` are hidden from the AI until the skill is activated; `tools` merely describes what the skill uses
  unlocks: string[]
  source: SkillSource
  dir: string
  path: string
  diagnostics: string[]
  sourceId?: string
  sourceName?: string
  packageId?: string
  packageName?: string
}

export interface SkillListItem extends SkillMetadata {
  enabled: boolean
  shadows: SkillMetadata[]
}

export interface Skill extends SkillMetadata {
  body: string
}

export interface SkillDiagnostic {
  name: string
  source: SkillSource
  path: string
  message: string
  sourceId?: string
  packageId?: string
}

export interface SkillLoader {
  list(): SkillMetadata[]
  listDetailed(): SkillListItem[]
  get(idOrName: string): Skill | undefined
  diagnostics(): SkillDiagnostic[]
}

export interface SourceSkillRoot {
  id: string
  name?: string
  dir: string
}

export interface PackageSkillRoot {
  packageId: string
  packageName?: string
  dir: string
}

export interface SkillLoaderOptions {
  builtinDir?: string
  personalDir?: string
  /**
   * Back-compat alias for the previous user-global root name. New callers
   * should pass personalDir.
   */
  globalDir?: string
  getSourceSkillRoots?: () => SourceSkillRoot[]
  getPackageSkillRoots?: () => PackageSkillRoot[]
  getWorkspacePath?: () => string | null | undefined
  disabledNames?: Set<string>
  getDisabledSkillNames?: () => Set<string>
}

interface ScanResult {
  skills: Skill[]
  detailed: SkillListItem[]
  diagnostics: SkillDiagnostic[]
}

interface AuthoredSkillRoot {
  source: AuthoredSkillSource
  dir: string
  sourceId?: string
  sourceName?: string
}

interface PackageRoot {
  source: 'package'
  dir: string
  packageId: string
  packageName?: string
}

type SkillRoot = AuthoredSkillRoot | PackageRoot

const PERSONAL_SKILLS_DIR = join(userHomeDir(), '.mim', 'skills')

export function resolveBuiltinSkillsDir(): string {
  const override = process.env.MIM_BUILTIN_SKILLS_PATH
  if (override && existsSync(override)) return override

  const appRoots = Array.from(new Set([
    process.cwd(),
    resolve(import.meta.dirname, '../..'),
    resolve(import.meta.dirname, '../../..'),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, '..') : '',
  ].filter(Boolean)))

  const candidates = appRoots.flatMap(root => [
    join(root, 'skills'),
    join(root, 'resources', 'skills'),
  ])

  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]
}

export function createSkillLoader(options: SkillLoaderOptions = {}): SkillLoader {
  const scan = () => scanSkills(options)

  return {
    list() {
      return scan().skills.map(metadataOnly)
    },
    listDetailed() {
      return scan().detailed
    },
    get(idOrName: string) {
      const trimmed = typeof idOrName === 'string' ? idOrName.trim() : ''
      if (!trimmed) return undefined
      return scan().skills.find(skill => skill.id === trimmed || (skill.source !== 'package' && skill.name === trimmed))
    },
    diagnostics() {
      return scan().diagnostics
    },
  }
}

function scanSkills(options: SkillLoaderOptions): ScanResult {
  const authoredByName = new Map<string, Skill>()
  const shadowsByName = new Map<string, Skill[]>()
  const diagnostics: SkillDiagnostic[] = []

  for (const root of authoredSkillRoots(options, diagnostics)) {
    for (const candidate of readSkillRoot(root, diagnostics)) {
      const existing = authoredByName.get(candidate.name)
      if (existing) {
        const shadows = shadowsByName.get(candidate.name) ?? []
        shadows.push(existing)
        shadowsByName.set(candidate.name, shadows)
        diagnostics.push({
          name: candidate.name,
          source: candidate.source,
          path: candidate.path,
          sourceId: candidate.sourceId,
          message: `Skill ${candidate.name} from ${existing.source} is shadowed by ${candidate.source}`,
        })
      }
      authoredByName.set(candidate.name, candidate)
    }
  }

  const disabledNames = options.getDisabledSkillNames?.() ?? options.disabledNames ?? new Set<string>()
  const resolvedAuthored = [...authoredByName.values()].sort((a, b) => a.name.localeCompare(b.name))
  const enabledAuthored = resolvedAuthored.filter(skill => !disabledNames.has(skill.name))
  const packageSkills = packageSkillRoots(options, diagnostics)
    .flatMap(root => readSkillRoot(root, diagnostics))
    .sort((a, b) => a.id.localeCompare(b.id))

  return {
    skills: [...enabledAuthored, ...packageSkills].sort((a, b) => a.id.localeCompare(b.id)),
    detailed: resolvedAuthored.map(skill => ({
      ...metadataOnly(skill),
      enabled: !disabledNames.has(skill.name),
      shadows: (shadowsByName.get(skill.name) ?? []).map(metadataOnly),
    })),
    diagnostics,
  }
}

function metadataOnly({ body: _body, ...metadata }: Skill): SkillMetadata {
  void _body
  return metadata
}

function authoredSkillRoots(options: SkillLoaderOptions, diagnostics: SkillDiagnostic[]): AuthoredSkillRoot[] {
  const roots: AuthoredSkillRoot[] = []
  const seenDirs = new Set<string>()
  const pushRoot = (root: AuthoredSkillRoot) => {
    const key = resolve(root.dir)
    if (seenDirs.has(key)) return
    seenDirs.add(key)
    roots.push(root)
  }

  pushRoot({ source: 'builtin', dir: options.builtinDir ?? resolveBuiltinSkillsDir() })

  try {
    for (const source of options.getSourceSkillRoots?.() ?? []) {
      if (!source?.id || !source.dir) continue
      pushRoot({
        source: 'source',
        dir: source.dir,
        sourceId: source.id,
        sourceName: source.name,
      })
    }
  } catch (err) {
    diagnostics.push({
      name: '*',
      source: 'source',
      path: '',
      message: `Could not read skill sources: ${(err as Error).message}`,
    })
  }

  const personalDir = options.personalDir ?? options.globalDir ?? PERSONAL_SKILLS_DIR
  if (personalDir) pushRoot({ source: 'personal', dir: personalDir })

  const workspacePath = options.getWorkspacePath?.()
  if (workspacePath) pushRoot({ source: 'workspace', dir: join(workspacePath, 'skills') })

  return roots
}

function packageSkillRoots(options: SkillLoaderOptions, diagnostics: SkillDiagnostic[]): PackageRoot[] {
  try {
    return (options.getPackageSkillRoots?.() ?? [])
      .filter(root => Boolean(root?.packageId && root.dir))
      .map(root => ({
        source: 'package',
        packageId: root.packageId,
        packageName: root.packageName,
        dir: root.dir,
      }))
  } catch (err) {
    diagnostics.push({
      name: '*',
      source: 'package',
      path: '',
      message: `Could not read package skill roots: ${(err as Error).message}`,
    })
    return []
  }
}

function readSkillRoot(root: SkillRoot, diagnostics: SkillDiagnostic[]): Skill[] {
  if (!existsSync(root.dir)) return []

  const skills: Skill[] = []
  for (const entry of readdirSync(root.dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root.dir, entry.name)
    const path = join(dir, 'SKILL.md')
    if (!existsSync(path)) continue
    if (!statSync(path).isFile()) continue

    const parsed = readSkillFile({
      expectedName: entry.name,
      root,
      dir,
      path,
    })
    diagnostics.push(...parsed.diagnostics)
    if (parsed.skill) skills.push(parsed.skill)
  }
  return skills
}

function readSkillFile(input: {
  expectedName: string
  root: SkillRoot
  dir: string
  path: string
}): { skill?: Skill; diagnostics: SkillDiagnostic[] } {
  const diagnostics: SkillDiagnostic[] = []
  const diagnose = (message: string) => diagnostics.push({
    name: input.expectedName,
    source: input.root.source,
    path: input.path,
    ...(input.root.source === 'source' ? { sourceId: input.root.sourceId } : {}),
    ...(input.root.source === 'package' ? { packageId: input.root.packageId } : {}),
    message,
  })

  let raw = ''
  try {
    raw = readFileSync(input.path, 'utf-8')
  } catch (err) {
    diagnose(`Could not read SKILL.md: ${(err as Error).message}`)
    return { diagnostics }
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw)
  if (!match) {
    diagnose('SKILL.md must start with YAML frontmatter')
    return { diagnostics }
  }

  let frontmatter: unknown
  try {
    frontmatter = parseYaml(match[1])
  } catch (err) {
    diagnose(`Invalid YAML frontmatter: ${(err as Error).message}`)
    return { diagnostics }
  }

  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    diagnose('SKILL.md frontmatter must be an object')
    return { diagnostics }
  }

  const meta = frontmatter as Record<string, unknown>
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const description = typeof meta.description === 'string' ? meta.description.trim() : ''
  if (!name) diagnose('Skill frontmatter requires name')
  if (name && name !== input.expectedName) diagnose('Skill name must match folder name')
  if (!description) diagnose('Skill frontmatter requires description')
  if (!name || name !== input.expectedName || !description) return { diagnostics }

  const tools = Array.isArray(meta.tools)
    ? meta.tools.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : []

  const unlocks = Array.isArray(meta.unlocks)
    ? meta.unlocks.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : []

  return {
    skill: {
      id: input.root.source === 'package'
        ? `package:${input.root.packageId}/${name}`
        : name,
      name,
      description,
      tools,
      unlocks,
      source: input.root.source,
      dir: input.dir,
      path: input.path,
      diagnostics: [],
      ...(input.root.source === 'source'
        ? { sourceId: input.root.sourceId, sourceName: input.root.sourceName }
        : {}),
      ...(input.root.source === 'package'
        ? { packageId: input.root.packageId, packageName: input.root.packageName }
        : {}),
      body: match[2].trim(),
    },
    diagnostics,
  }
}
