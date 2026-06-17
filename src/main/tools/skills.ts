import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { parse as parseYaml } from 'yaml'
import {
  createSkillLoader,
  type PackageSkillRoot,
  type Skill,
  type SkillLoader,
  type SkillMetadata,
  type SourceSkillRoot,
} from '@main/skills.js'
import { cloneRepo, checkoutRemoteDefault, fetchRepo } from '@main/git.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import {
  loadUserConfig,
  removeSkillSource,
  setUserSkillDisabled,
  USER_SKILL_NAME_PATTERN,
  USER_SKILL_SOURCE_ID_PATTERN,
  writeSkillSource,
  type SkillSourceConfig,
} from '@main/userConfig.js'
import { userHomeDir } from '@main/platform.js'

export interface SkillToolOptions {
  loader?: SkillLoader
  builtinDir?: string
  personalDir?: string
  homeDir?: string
  getPackageSkillRoots?: () => PackageSkillRoot[]
  emit?: (channel: string) => void
}

interface ParsedSkillFolder {
  skill: Skill
  unlocks: string[]
  diagnostics: string[]
}

interface InspectedSkillSource {
  id: string
  name?: string
  kind: 'path' | 'git'
  location: string
  root: string
  skillCount: number
  skills: SkillMetadata[]
  unlocks: string[]
  diagnostics: string[]
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerSkillTools(tools: ToolRegistry, options: SkillToolOptions = {}): void {
  const home = options.homeDir ?? userHomeDir()
  const personalDir = options.personalDir ?? join(home, '.mim', 'skills')
  const loader = () => options.loader ?? createDefaultLoader(tools, options, home, personalDir)
  const emitChanged = () => options.emit?.('skills:changed')

  tools.register({
    name: 'skill.list',
    description: 'List available AI skills as metadata only. Body text is returned by skill.get. Pass detailed=true for Settings metadata including disabled and shadowed authored skills.',
    inputSchema: objectSchema({ detailed: { type: 'boolean' } }),
    execute: async (params) => ({
      skills: params.detailed === true ? loader().listDetailed() : loader().list(),
      diagnostics: loader().diagnostics(),
    }),
  })

  tools.register({
    name: 'skill.get',
    description: 'Activate a skill by name or package-qualified id and return its SKILL.md body plus declared tools.',
    inputSchema: objectSchema({ name: { type: 'string' } }, ['name']),
    execute: async (params) => {
      const name = typeof params.name === 'string' ? params.name.trim() : ''
      if (!name) throw new Error('Missing required parameter: name')
      const skill = loader().get(name)
      if (!skill) throw new Error(`Skill not found: ${name}`)
      return { skill }
    },
  })

  tools.register({
    name: 'skill.setDisabled',
    description: 'Enable or disable an authored skill globally by writing skills.disabled in ~/.mim/config.yaml.',
    inputSchema: objectSchema({
      name: { type: 'string' },
      disabled: { type: 'boolean' },
    }, ['name', 'disabled']),
    execute: async (params) => {
      const name = requireSkillName(params.name)
      setUserSkillDisabled(name, params.disabled === true, home)
      emitChanged()
      return { name, disabled: params.disabled === true }
    },
  })

  tools.register({
    name: 'skill.create',
    description: 'Create a new Personal skill template at ~/.mim/skills/<name>/SKILL.md.',
    inputSchema: objectSchema({
      name: { type: 'string' },
      description: { type: 'string' },
    }, ['name']),
    execute: async (params) => {
      const name = requireSkillName(params.name)
      const description = typeof params.description === 'string' && params.description.trim()
        ? params.description.trim()
        : `Use when the user wants help with ${name.replace(/-/g, ' ')}.`
      const dir = join(personalDir, name)
      const path = join(dir, 'SKILL.md')
      if (existsSync(path)) throw new Error(`Skill already exists: ${name}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, personalSkillTemplate(name, description), 'utf-8')
      emitChanged()
      return {
        skill: {
          id: name,
          name,
          description,
          source: 'personal',
          dir,
          path,
        },
      }
    },
  })

  tools.register({
    name: 'skill.inspectImport',
    description: 'Inspect a SKILL.md folder before importing it into Personal skills.',
    inputSchema: objectSchema({ folder: { type: 'string' } }, ['folder']),
    execute: async (params) => {
      const folder = requireAbsoluteFolder(params.folder)
      assertNoSymlinks(folder)
      const inspected = inspectSkillFolder(folder, 'personal', {}, { requireFolderName: false })
      return {
        skill: inspected.skill,
        unlocks: inspected.unlocks,
        diagnostics: inspected.diagnostics,
        destination: join(personalDir, inspected.skill.name),
        collision: existsSync(join(personalDir, inspected.skill.name, 'SKILL.md')),
      }
    },
  })

  tools.register({
    name: 'skill.import',
    description: 'Import an inspected skill folder into Personal skills. Requires confirmed=true.',
    inputSchema: objectSchema({
      folder: { type: 'string' },
      confirmed: { type: 'boolean' },
    }, ['folder']),
    execute: async (params) => {
      if (params.confirmed !== true) throw new Error('Import requires confirmation after inspection')
      const folder = requireAbsoluteFolder(params.folder)
      assertNoSymlinks(folder)
      const inspected = inspectSkillFolder(folder, 'personal', {}, { requireFolderName: false })
      const destination = join(personalDir, inspected.skill.name)
      if (existsSync(destination)) throw new Error(`Skill already exists: ${inspected.skill.name}`)
      copyTreeNoSymlinks(folder, destination)
      emitChanged()
      const imported = loader().get(inspected.skill.name)
      return {
        skill: imported ? metadataOnly(imported) : {
          ...metadataOnly(inspected.skill),
          source: 'personal',
          dir: destination,
          path: join(destination, 'SKILL.md'),
        },
        unlocks: inspected.unlocks,
        diagnostics: inspected.diagnostics,
      }
    },
  })

  tools.register({
    name: 'skill.delete',
    description: 'Delete a Personal skill by name.',
    inputSchema: objectSchema({ name: { type: 'string' } }, ['name']),
    execute: async (params) => {
      const name = requireSkillName(params.name)
      const dir = join(personalDir, name)
      if (!existsSync(dir)) throw new Error(`Personal skill not found: ${name}`)
      rmSync(dir, { recursive: true, force: true })
      emitChanged()
      return { deleted: name }
    },
  })

  tools.register({
    name: 'skillSource.list',
    description: 'List trusted user-added skill sources and their current scan status.',
    inputSchema: objectSchema({}),
    execute: async () => ({ sources: listConfiguredSources(home) }),
  })

  tools.register({
    name: 'skillSource.inspect',
    description: 'Inspect a local path or Git repository before adding it as a trusted skill source.',
    inputSchema: objectSchema({
      id: { type: 'string' },
      name: { type: 'string' },
      path: { type: 'string' },
      git: { type: 'string' },
    }),
    execute: async (params) => inspectSourceParams(params, home),
  })

  tools.register({
    name: 'skillSource.add',
    description: 'Add an inspected local path or Git repository as a trusted skill source. Requires confirmed=true.',
    inputSchema: objectSchema({
      id: { type: 'string' },
      name: { type: 'string' },
      path: { type: 'string' },
      git: { type: 'string' },
      confirmed: { type: 'boolean' },
    }),
    execute: async (params) => {
      if (params.confirmed !== true) throw new Error('Adding a skill source requires confirmation after inspection')
      const inspected = await inspectSourceParams(params, home)
      const entry: SkillSourceConfig = {
        ...(inspected.name ? { name: inspected.name } : {}),
        trusted: true,
        ...(inspected.kind === 'path' ? { path: inspected.location } : { git: inspected.location }),
      }
      if (inspected.kind === 'git') {
        await syncGitSkillSource(inspected.location, sourceMirrorDir(home, inspected.id))
      }
      writeSkillSource(inspected.id, entry, home)
      emitChanged()
      return { source: sourceListItem(inspected.id, entry, home), inspected }
    },
  })

  tools.register({
    name: 'skillSource.remove',
    description: 'Remove a user-added skill source from ~/.mim/config.yaml. Git mirrors are deleted; local path contents are untouched.',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async (params) => {
      const id = requireSourceId(params.id)
      const source = loadUserConfig(home).skillSources[id]
      removeSkillSource(id, home)
      if (source?.git) rmSync(sourceMirrorDir(home, id), { recursive: true, force: true })
      emitChanged()
      return { removed: id }
    },
  })

  tools.register({
    name: 'skillSource.refresh',
    description: 'Refresh a user-added skill source. Git sources fetch latest default branch; local paths are re-scanned on demand.',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async (params) => {
      const id = requireSourceId(params.id)
      const source = loadUserConfig(home).skillSources[id]
      if (!source) throw new Error(`Skill source not found: ${id}`)
      if (source.git) await syncGitSkillSource(source.git, sourceMirrorDir(home, id))
      emitChanged()
      return { refreshed: id, source: sourceListItem(id, source, home) }
    },
  })
}

function createDefaultLoader(
  tools: ToolRegistry,
  options: SkillToolOptions,
  home: string,
  personalDir: string,
): SkillLoader {
  return createSkillLoader({
    builtinDir: options.builtinDir,
    personalDir,
    getWorkspacePath: () => tools.getWorkspacePath(),
    getSourceSkillRoots: () => sourceRootsFromConfig(home),
    getPackageSkillRoots: options.getPackageSkillRoots,
    getDisabledSkillNames: () => new Set(loadUserConfig(home).skills.disabled),
  })
}

function sourceRootsFromConfig(home: string): SourceSkillRoot[] {
  return Object.entries(loadUserConfig(home).skillSources)
    .filter(([, source]) => source.trusted === true)
    .map(([id, source]) => ({
      id,
      name: source.name,
      dir: source.path ?? sourceMirrorDir(home, id),
    }))
}

function listConfiguredSources(home: string): Array<Record<string, unknown>> {
  return Object.entries(loadUserConfig(home).skillSources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, source]) => sourceListItem(id, source, home))
}

function sourceListItem(id: string, source: SkillSourceConfig, home: string): Record<string, unknown> {
  const kind = source.path ? 'path' : 'git'
  const location = source.path ?? source.git ?? ''
  const root = source.path ?? sourceMirrorDir(home, id)
  const scan = inspectSkillSourceRoot(id, source.name, kind, location, root)
  return {
    id,
    ...(source.name ? { name: source.name } : {}),
    kind,
    location,
    trusted: source.trusted === true,
    status: scan.status,
    skillCount: scan.skillCount,
    unlocks: scan.unlocks,
    diagnostics: scan.diagnostics,
  }
}

async function inspectSourceParams(params: Record<string, unknown>, home: string): Promise<InspectedSkillSource> {
  const rawPath = typeof params.path === 'string' ? params.path.trim() : ''
  const rawGit = typeof params.git === 'string' ? params.git.trim() : ''
  if (Boolean(rawPath) === Boolean(rawGit)) throw new Error('Specify exactly one of path or git')

  const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : undefined
  const id = requireSourceId(typeof params.id === 'string' && params.id.trim()
    ? params.id
    : defaultSourceId(name ?? (rawPath || rawGit)))

  if (rawPath) {
    const root = requireAbsoluteFolder(rawPath)
    const scan = inspectSkillSourceRoot(id, name, 'path', root, root)
    return {
      id,
      ...(name ? { name } : {}),
      kind: 'path',
      location: root,
      root,
      ...scan,
    }
  }

  const tmp = join(tmpdir(), `mim-skill-source-${id}-${randomBytes(6).toString('hex')}`)
  try {
    await syncGitSkillSource(rawGit, tmp)
    const scan = inspectSkillSourceRoot(id, name, 'git', rawGit, tmp)
    return {
      id,
      ...(name ? { name } : {}),
      kind: 'git',
      location: rawGit,
      root: tmp,
      ...scan,
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function inspectSkillSourceRoot(
  id: string,
  name: string | undefined,
  kind: 'path' | 'git',
  location: string,
  root: string,
): Omit<InspectedSkillSource, 'id' | 'name' | 'kind' | 'location' | 'root'> & { status: string } {
  const diagnostics: string[] = []
  if (!existsSync(root)) {
    return { status: 'missing', skillCount: 0, skills: [], unlocks: [], diagnostics: [`Source not found: ${location}`] }
  }
  try {
    if (!statSync(root).isDirectory()) {
      return { status: 'invalid', skillCount: 0, skills: [], unlocks: [], diagnostics: [`Source is not a directory: ${location}`] }
    }
  } catch (err) {
    return { status: 'error', skillCount: 0, skills: [], unlocks: [], diagnostics: [(err as Error).message] }
  }

  const skills: SkillMetadata[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const folder = join(root, entry.name)
    try {
      if (lstatSync(folder).isSymbolicLink()) {
        diagnostics.push(`Skipping symlinked skill folder: ${entry.name}`)
        continue
      }
      const parsed = inspectSkillFolder(folder, 'source', { sourceId: id, sourceName: name })
      skills.push(metadataOnly(parsed.skill))
      diagnostics.push(...parsed.diagnostics)
    } catch (err) {
      diagnostics.push(`${entry.name}: ${(err as Error).message}`)
    }
  }
  const unlocks = uniqueSorted(skills.flatMap(skill => skill.unlocks))
  return {
    status: 'ok',
    skillCount: skills.length,
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    unlocks,
    diagnostics,
  }
}

function inspectSkillFolder(
  folder: string,
  source: 'personal' | 'source',
  extra: { sourceId?: string; sourceName?: string } = {},
  options: { requireFolderName?: boolean } = {},
): ParsedSkillFolder {
  const skillMd = join(folder, 'SKILL.md')
  if (!existsSync(skillMd) || !statSync(skillMd).isFile()) {
    throw new Error(`Missing SKILL.md: ${folder}`)
  }
  const raw = readFileSync(skillMd, 'utf-8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw)
  if (!match) throw new Error('SKILL.md must start with YAML frontmatter')

  const diagnostics: string[] = []
  let frontmatter: unknown
  try {
    frontmatter = parseYaml(match[1])
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${(err as Error).message}`)
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('SKILL.md frontmatter must be an object')
  }

  const meta = frontmatter as Record<string, unknown>
  const expectedName = basename(folder)
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const description = typeof meta.description === 'string' ? meta.description.trim() : ''
  if (!USER_SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid skill name: ${name || String(meta.name)}`)
  if (options.requireFolderName !== false && name !== expectedName) throw new Error('Skill name must match folder name')
  if (!description) throw new Error('Skill frontmatter requires description')

  const tools = stringArray(meta.tools)
  const unlocks = stringArray(meta.unlocks)
  const skill: Skill = {
    id: name,
    name,
    description,
    tools,
    unlocks,
    source,
    dir: folder,
    path: skillMd,
    diagnostics: [],
    ...(source === 'source' ? { sourceId: extra.sourceId, sourceName: extra.sourceName } : {}),
    body: match[2].trim(),
  }
  return { skill, unlocks, diagnostics }
}

function metadataOnly({ body: _body, ...metadata }: Skill): SkillMetadata {
  void _body
  return metadata
}

function requireSkillName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!USER_SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid skill name: ${name || String(value)}`)
  return name
}

function requireSourceId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!USER_SKILL_SOURCE_ID_PATTERN.test(id)) throw new Error(`Invalid skill source id: ${id || String(value)}`)
  return id
}

function requireAbsoluteFolder(value: unknown): string {
  const folder = typeof value === 'string' ? value.trim() : ''
  if (!folder) throw new Error('Missing required folder path')
  if (!isAbsolute(folder)) throw new Error(`Folder path must be absolute: ${folder}`)
  const resolved = resolve(folder)
  const stat = lstatSync(resolved)
  if (stat.isSymbolicLink()) throw new Error(`Symlink paths are not allowed: ${folder}`)
  if (!stat.isDirectory()) throw new Error(`Folder is not a directory: ${folder}`)
  return resolved
}

function assertNoSymlinks(root: string): void {
  const current = lstatSync(root)
  if (current.isSymbolicLink()) throw new Error(`Symlink paths are not allowed: ${root}`)
  if (!current.isDirectory()) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = join(root, entry.name)
    const stat = lstatSync(child)
    if (stat.isSymbolicLink()) throw new Error(`Symlink entries are not allowed: ${child}`)
    if (stat.isDirectory()) assertNoSymlinks(child)
  }
}

function copyTreeNoSymlinks(source: string, destination: string): void {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error(`Symlink entries are not allowed: ${source}`)
  if (stat.isDirectory()) {
    if (basename(source) === '.git') return
    mkdirSync(destination, { recursive: true })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      copyTreeNoSymlinks(join(source, entry.name), join(destination, entry.name))
    }
    return
  }
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

async function syncGitSkillSource(url: string, destination: string): Promise<void> {
  if (!url.trim()) throw new Error('Missing git URL')
  if (existsSync(destination)) {
    await fetchRepo(destination)
    await checkoutRemoteDefault(destination)
    return
  }
  mkdirSync(dirname(destination), { recursive: true })
  await cloneRepo(url, destination)
  await checkoutRemoteDefault(destination)
}

function sourceMirrorDir(home: string, id: string): string {
  return join(home, '.mim', 'skill-sources', id)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : []
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort()
}

function defaultSourceId(value: string): string {
  const source = value.trim().replace(/\.git$/, '').split(/[\\/]/).pop() || 'skills'
  const slug = source.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return USER_SKILL_SOURCE_ID_PATTERN.test(slug) ? slug : `source-${randomBytes(3).toString('hex')}`
}

function personalSkillTemplate(name: string, description: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    'tools: []',
    'unlocks: []',
    '---',
    '',
    `# ${titleFromName(name)}`,
    '',
    '## When to use',
    '',
    '- Use this skill when the request matches the description above.',
    '',
    '## Instructions',
    '',
    '- Add concise, operational guidance for the assistant.',
    '',
  ].join('\n')
}

function titleFromName(name: string): string {
  return name.split('-')
    .filter(Boolean)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
