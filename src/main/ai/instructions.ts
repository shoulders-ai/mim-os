import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { parse as parseYaml } from 'yaml'
import { userHomeDir } from '@main/platform.js'
import { resolveBuiltinSkillsDir } from '@main/skills.js'
import { MIM_INSTRUCTIONS_TEMPLATE } from '@main/workspace/workspaceContract.js'

export type InstructionOrigin = 'mim' | 'team' | 'personal' | 'project'

export interface InstructionDocument {
  origin: InstructionOrigin
  label: string
  path: string | null
  editorPath: string
  content: string
  writable: boolean
}

export interface InstructionLoadOptions {
  workspacePath?: string
  homeDir?: string
}

export interface OriginEditorDocuments {
  personalInstructions: string
  mimInstructions: string
  personalSkills: string
  mimSkills: string
}

export const MIM_INSTRUCTIONS = MIM_INSTRUCTIONS_TEMPLATE
export const PERSONAL_INSTRUCTIONS_TEMPLATE = `# Personal Instructions

Add durable preferences that should apply across all of your Projects.
`

const ORIGIN_ROOT = join('.mim', 'origins')
const PERSONAL_INSTRUCTIONS_EDITOR_PATH = join(ORIGIN_ROOT, 'you', 'instructions.md')
const MIM_INSTRUCTIONS_EDITOR_PATH = join(ORIGIN_ROOT, 'mim', 'instructions.md')
const PERSONAL_SKILLS_EDITOR_PATH = join(ORIGIN_ROOT, 'you', 'skills')
const MIM_SKILLS_EDITOR_PATH = join(ORIGIN_ROOT, 'mim', 'skills')

export function loadInstructionDocuments(options: InstructionLoadOptions = {}): InstructionDocument[] {
  const home = options.homeDir ?? userHomeDir()
  const workspacePath = options.workspacePath
  const docs: InstructionDocument[] = [{
    origin: 'mim',
    label: 'Mim',
    path: null,
    editorPath: slash(MIM_INSTRUCTIONS_EDITOR_PATH),
    content: MIM_INSTRUCTIONS,
    writable: false,
  }]

  const teamRoot = join(home, '.mim', 'team')
  const teamInstructions = join(teamRoot, 'instructions.md')
  const teamName = readTeamName(join(teamRoot, 'team.yaml'))
  const teamContent = readOptional(teamInstructions)
  if (teamName && teamContent !== null) {
    docs.push({
      origin: 'team',
      label: teamName,
      path: teamInstructions,
      editorPath: '.mim/team/instructions.md',
      content: teamContent,
      writable: true,
    })
  }

  const personalPath = join(home, '.mim', 'instructions.md')
  const personalContent = readOptional(personalPath)
  if (personalContent !== null) {
    docs.push({
      origin: 'personal',
      label: 'You',
      path: personalPath,
      editorPath: slash(PERSONAL_INSTRUCTIONS_EDITOR_PATH),
      content: personalContent,
      writable: true,
    })
  }

  if (workspacePath) {
    const projectPath = join(workspacePath, 'AGENTS.md')
    const projectContent = readOptional(projectPath)
    if (projectContent !== null) {
      docs.push({
        origin: 'project',
        label: readProjectName(workspacePath) ?? 'Project',
        path: projectPath,
        editorPath: 'AGENTS.md',
        content: projectContent,
        writable: true,
      })
    }
  }

  return docs
}

export function composeInstructions(documents: InstructionDocument[]): string {
  return documents
    .map(doc => `# ${doc.origin.toUpperCase()} INSTRUCTIONS${doc.origin === 'mim' ? '' : ` — ${doc.label}`}\n\n${doc.content.trim()}`)
    .join('\n\n\n')
}

export function ensureInstructionEditorDocuments(options: {
  workspacePath: string
  homeDir?: string
  builtinSkillsDir?: string
}): OriginEditorDocuments {
  const workspace = resolve(options.workspacePath)
  const home = options.homeDir ?? userHomeDir()
  const personalInstructions = join(home, '.mim', 'instructions.md')
  const personalSkills = join(home, '.mim', 'skills')
  const mimInstructions = join(workspace, MIM_INSTRUCTIONS_EDITOR_PATH)
  const builtinSkills = options.builtinSkillsDir ?? resolveBuiltinSkillsDir()

  mkdirSync(dirname(personalInstructions), { recursive: true })
  if (!existsSync(personalInstructions)) {
    writeFileSync(personalInstructions, PERSONAL_INSTRUCTIONS_TEMPLATE, 'utf-8')
  }
  mkdirSync(personalSkills, { recursive: true })

  const personalInstructionsMount = join(workspace, PERSONAL_INSTRUCTIONS_EDITOR_PATH)
  const personalSkillsMount = join(workspace, PERSONAL_SKILLS_EDITOR_PATH)
  const mimSkillsMount = join(workspace, MIM_SKILLS_EDITOR_PATH)
  mkdirSync(dirname(personalInstructionsMount), { recursive: true })
  mkdirSync(dirname(mimInstructions), { recursive: true })
  writeFileSync(mimInstructions, MIM_INSTRUCTIONS, 'utf-8')
  syncManagedLink(personalInstructionsMount, personalInstructions, 'file')
  syncManagedLink(personalSkillsMount, personalSkills, 'dir')
  syncManagedLink(mimSkillsMount, builtinSkills, 'dir')

  return {
    personalInstructions: slash(relative(workspace, personalInstructionsMount)),
    mimInstructions: slash(relative(workspace, mimInstructions)),
    personalSkills: slash(relative(workspace, personalSkillsMount)),
    mimSkills: slash(relative(workspace, mimSkillsMount)),
  }
}

function syncManagedLink(path: string, target: string, type: 'file' | 'dir'): void {
  let current: ReturnType<typeof lstatSync> | null = null
  try { current = lstatSync(path) } catch { /* absent */ }
  if (current) {
    if (!current.isSymbolicLink()) {
      throw new Error(`Managed origin path is occupied: ${path}`)
    }
    if (resolve(dirname(path), readlinkSync(path)) === resolve(target)) return
    rmSync(path, { force: true })
  }
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path, type === 'dir' && process.platform === 'win32' ? 'junction' : type)
}

function readOptional(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function readTeamName(path: string): string | null {
  const content = readOptional(path)
  if (content === null) return null
  try {
    const parsed = parseYaml(content) as { name?: unknown }
    return typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null
  } catch {
    return null
  }
}

function readProjectName(workspacePath: string): string | null {
  const content = readOptional(join(workspacePath, 'mim.yaml'))
  if (content === null) return null
  try {
    const parsed = parseYaml(content) as { name?: unknown }
    return typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null
  } catch {
    return null
  }
}

function slash(path: string): string {
  return path.replaceAll('\\', '/')
}
