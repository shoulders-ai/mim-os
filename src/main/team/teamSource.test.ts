import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reset as resetUserConfig } from '@main/userConfig.js'
import {
  createTeamSource,
  repositoryUsesGitLfs,
  resolveTeamCheckout,
  teamCheckoutPath,
} from '@main/team/teamSource.js'

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function seedRemote(root: string, options: { lfs?: boolean } = {}): string {
  const source = join(root, 'source')
  const remote = join(root, 'team.git')
  mkdirSync(source)
  git(['init', '--initial-branch=main'], source)
  git(['config', 'user.name', 'Mim Team Test'], source)
  git(['config', 'user.email', 'team-test@example.com'], source)
  writeFileSync(join(source, 'team.yaml'), 'name: Shoulders\n')
  writeFileSync(join(source, 'instructions.md'), '# Team guidance\n')
  if (options.lfs) {
    writeFileSync(join(source, '.gitattributes'), '*.docx filter=lfs diff=lfs merge=lfs -text\n')
  }
  for (const dir of ['files', 'skills', 'apps', 'routines']) {
    mkdirSync(join(source, dir))
    writeFileSync(join(source, dir, '.gitkeep'), '')
  }
  git(['add', '-A'], source)
  git(['commit', '-m', 'Seed Team'], source)
  git(['init', '--bare', '--initial-branch=main', remote])
  git(['remote', 'add', 'origin', remote], source)
  git(['push', '-u', 'origin', 'main'], source)
  return remote
}

function configureIdentity(checkout: string): void {
  git(['config', 'user.name', 'Mim Team Test'], checkout)
  git(['config', 'user.email', 'team-test@example.com'], checkout)
}

describe('Team source contract', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-team-contract-'))
    resetUserConfig()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetUserConfig()
  })

  it('requires a named team.yaml and treats every other contribution as optional', () => {
    const checkout = join(root, 'checkout')
    mkdirSync(checkout)
    writeFileSync(join(checkout, 'team.yaml'), 'name: Shoulders\n')

    expect(resolveTeamCheckout(checkout)).toEqual({
      name: 'Shoulders',
      root: checkout,
      manifestPath: join(checkout, 'team.yaml'),
      instructionsPath: null,
      filesPath: join(checkout, 'files'),
      skillsPath: join(checkout, 'skills'),
      appsPath: join(checkout, 'apps'),
      routinesPath: join(checkout, 'routines'),
      contributions: {
        instructions: false,
        files: 0,
        skills: 0,
        apps: 0,
        routines: 0,
      },
    })
  })

  it('validates contribution kinds and counts their immediate entries', () => {
    const checkout = join(root, 'checkout')
    mkdirSync(checkout)
    writeFileSync(join(checkout, 'team.yaml'), 'name: Shoulders\n')
    writeFileSync(join(checkout, 'instructions.md'), '# Shared instructions\n')
    for (const dir of ['files', 'skills', 'apps', 'routines']) mkdirSync(join(checkout, dir))
    writeFileSync(join(checkout, 'files', 'template.md'), 'Template')
    mkdirSync(join(checkout, 'skills', 'review'))
    mkdirSync(join(checkout, 'apps', 'tracker'))
    mkdirSync(join(checkout, 'routines', 'daily'))

    const resolved = resolveTeamCheckout(checkout)
    expect(resolved.instructionsPath).toBe(join(checkout, 'instructions.md'))
    expect(resolved.contributions).toEqual({
      instructions: true,
      files: 1,
      skills: 1,
      apps: 1,
      routines: 1,
    })

    rmSync(join(checkout, 'skills'), { recursive: true })
    writeFileSync(join(checkout, 'skills'), 'not a directory')
    expect(() => resolveTeamCheckout(checkout)).toThrow('skills/ must be a directory')
  })

  it('rejects missing, malformed, and unnamed manifests', () => {
    const checkout = join(root, 'checkout')
    mkdirSync(checkout)
    expect(() => resolveTeamCheckout(checkout)).toThrow('team.yaml')

    writeFileSync(join(checkout, 'team.yaml'), 'name: [broken')
    expect(() => resolveTeamCheckout(checkout)).toThrow('valid YAML')

    writeFileSync(join(checkout, 'team.yaml'), 'name: "   "\n')
    expect(() => resolveTeamCheckout(checkout)).toThrow('non-empty name')
  })

  it('detects Git LFS only when repository attributes request its filter', () => {
    const checkout = join(root, 'checkout')
    mkdirSync(join(checkout, 'files'), { recursive: true })
    expect(repositoryUsesGitLfs(checkout)).toBe(false)

    writeFileSync(join(checkout, '.gitattributes'), '*.pdf binary\n')
    writeFileSync(join(checkout, 'files', '.gitattributes'), '*.docx filter=lfs diff=lfs merge=lfs -text\n')
    expect(repositoryUsesGitLfs(checkout)).toBe(true)
  })
})

describe('Team source connection and sync', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-team-source-'))
    resetUserConfig()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetUserConfig()
  })

  it('reports a disconnected installation without creating Personal state', async () => {
    const home = join(root, 'home')
    mkdirSync(home)
    const source = createTeamSource({ homeDir: home })

    await expect(source.status()).resolves.toMatchObject({
      state: 'disconnected',
      repository: null,
      root: teamCheckoutPath(home),
      git: { available: true },
    })
    expect(existsSync(join(home, '.mim', 'config.yaml'))).toBe(false)
  })

  it('clones, validates, and persists exactly one credential-free Team connection', async () => {
    const remote = seedRemote(root)
    const home = join(root, 'home')
    mkdirSync(home)
    const source = createTeamSource({ homeDir: home })

    const connected = await source.connect(remote)

    expect(connected).toMatchObject({
      state: 'synced',
      repository: remote,
      team: { name: 'Shoulders' },
      dirty: false,
      ahead: 0,
      behind: 0,
    })
    expect(connected.root).toBe(teamCheckoutPath(home))
    expect(readFileSync(join(home, '.mim', 'config.yaml'), 'utf-8')).toContain(`repository: ${remote}`)
    expect(await source.open()).toMatchObject({ name: 'Shoulders', root: teamCheckoutPath(home) })
    await expect(source.connect(remote)).rejects.toThrow('already connected')
  })

  it('does not persist or retain a clone when the Team contract is invalid', async () => {
    const sourceDir = join(root, 'invalid-source')
    const remote = join(root, 'invalid.git')
    mkdirSync(sourceDir)
    git(['init', '--initial-branch=main'], sourceDir)
    git(['config', 'user.name', 'Mim Team Test'], sourceDir)
    git(['config', 'user.email', 'team-test@example.com'], sourceDir)
    writeFileSync(join(sourceDir, 'README.md'), 'No Team manifest')
    git(['add', '-A'], sourceDir)
    git(['commit', '-m', 'Invalid Team'], sourceDir)
    git(['init', '--bare', '--initial-branch=main', remote])
    git(['remote', 'add', 'origin', remote], sourceDir)
    git(['push', '-u', 'origin', 'main'], sourceDir)

    const home = join(root, 'home')
    mkdirSync(home)
    const source = createTeamSource({ homeDir: home })

    await expect(source.connect(remote)).rejects.toThrow('team.yaml')
    expect(existsSync(teamCheckoutPath(home))).toBe(false)
    expect(existsSync(join(home, '.mim', 'config.yaml'))).toBe(false)
  })

  it('uses system Git for both clients and synchronizes writable Team changes end to end', async () => {
    const remote = seedRemote(root)
    const homeA = join(root, 'home-a')
    const homeB = join(root, 'home-b')
    mkdirSync(homeA)
    mkdirSync(homeB)
    const clientA = createTeamSource({ homeDir: homeA })
    const clientB = createTeamSource({ homeDir: homeB })
    await clientA.connect(remote)
    await clientB.connect(remote)
    configureIdentity(teamCheckoutPath(homeA))
    configureIdentity(teamCheckoutPath(homeB))

    writeFileSync(join(teamCheckoutPath(homeA), 'files', 'brief.md'), 'Version A\n')
    await expect(clientA.status()).resolves.toMatchObject({ state: 'needs-sync', dirty: true })
    await expect(clientA.sync()).resolves.toMatchObject({ state: 'synced', dirty: false })

    await clientB.sync()
    expect(readFileSync(join(teamCheckoutPath(homeB), 'files', 'brief.md'), 'utf-8')).toBe('Version A\n')

    writeFileSync(join(teamCheckoutPath(homeB), 'files', 'brief.md'), 'Version B\n')
    await clientB.sync()
    await clientA.sync()
    expect(readFileSync(join(teamCheckoutPath(homeA), 'files', 'brief.md'), 'utf-8')).toBe('Version B\n')
  })

  it('rejects HTTP repositories and credential-bearing URLs before invoking Git', async () => {
    const home = join(root, 'home')
    mkdirSync(home)
    const source = createTeamSource({ homeDir: home })

    await expect(source.connect('http://example.com/team.git')).rejects.toThrow('HTTPS')
    await expect(source.connect('https://user:secret@example.com/team.git')).rejects.toThrow('credentials')
    expect(existsSync(teamCheckoutPath(home))).toBe(false)
  })

  it('requires Git LFS only when the connected repository attributes use it', async () => {
    const remote = seedRemote(root, { lfs: true })
    const home = join(root, 'home')
    mkdirSync(home)
    const source = createTeamSource({
      homeDir: home,
      platform: 'darwin',
      hasGitLfs: async () => false,
    })

    await expect(source.connect(remote)).rejects.toThrow('brew install git-lfs')
    expect(existsSync(teamCheckoutPath(home))).toBe(false)
    expect(existsSync(join(home, '.mim', 'config.yaml'))).toBe(false)
  })
})
