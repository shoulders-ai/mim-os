import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TOOLCHAIN_CATALOG,
  detectToolchain,
  resetToolchainDetection,
  resolveInterpreter,
  type ExecLoginShell,
  type ExecVersion,
} from '@main/toolchain/toolchain.js'

function execReturning(map: Record<string, { stdout: string; exitCode: number }>) {
  return vi.fn<ExecLoginShell>(async (_shell, args) => {
    const command = args[args.length - 1]
    for (const [bin, result] of Object.entries(map)) {
      if (command === bin || command.includes(`command -v ${bin}`)) return result
    }
    return { stdout: '', exitCode: 1 }
  })
}

const noVersion: ExecVersion = async () => ''

afterEach(() => {
  resetToolchainDetection()
})

describe('toolchain catalog', () => {
  it('covers the interpreter allowlist candidates', () => {
    expect(TOOLCHAIN_CATALOG.map(entry => entry.id)).toEqual([
      'r',
      'rscript',
      'quarto',
      'pandoc',
      'python3',
    ])
    const rscript = TOOLCHAIN_CATALOG.find(entry => entry.id === 'rscript')
    expect(rscript?.bin).toBe('Rscript')
  })
})

describe('detectToolchain', () => {
  it('detects installed binaries with absolute paths and versions', async () => {
    const exec = execReturning({
      Rscript: { stdout: '/opt/homebrew/bin/Rscript\n', exitCode: 0 },
      quarto: { stdout: '/usr/local/bin/quarto\n', exitCode: 0 },
    })
    const execVersion: ExecVersion = async (binPath) => {
      if (binPath.endsWith('Rscript')) return 'Rscript (R) scripting front-end version 4.4.1 (2024-06-14)\nextra noise'
      if (binPath.endsWith('quarto')) return '1.5.57\n'
      return ''
    }

    const entries = await detectToolchain({ exec, execVersion, platform: 'darwin', env: {} })
    const rscript = entries.find(entry => entry.id === 'rscript')
    const quarto = entries.find(entry => entry.id === 'quarto')
    const pandoc = entries.find(entry => entry.id === 'pandoc')

    expect(rscript).toMatchObject({
      installed: true,
      binPath: '/opt/homebrew/bin/Rscript',
      version: 'Rscript (R) scripting front-end version 4.4.1 (2024-06-14)',
    })
    expect(quarto).toMatchObject({ installed: true, binPath: '/usr/local/bin/quarto', version: '1.5.57' })
    expect(pandoc).toMatchObject({ installed: false })
    expect(pandoc?.binPath).toBeUndefined()
  })

  it('keeps a binary installed when version capture fails', async () => {
    const exec = execReturning({ Rscript: { stdout: '/usr/bin/Rscript\n', exitCode: 0 } })
    const execVersion: ExecVersion = async () => { throw new Error('boom') }

    const entries = await detectToolchain({ exec, execVersion, platform: 'darwin', env: {} })
    const rscript = entries.find(entry => entry.id === 'rscript')

    expect(rscript).toMatchObject({ installed: true, binPath: '/usr/bin/Rscript' })
    expect(rscript?.version).toBeUndefined()
  })

  it('caches the detection promise until reset', async () => {
    const exec = execReturning({})
    const first = detectToolchain({ exec, execVersion: noVersion, platform: 'darwin', env: {} })
    const second = detectToolchain({ exec, execVersion: noVersion, platform: 'darwin', env: {} })
    expect(second).toBe(first)
    await first

    resetToolchainDetection()
    const third = detectToolchain({ exec, execVersion: noVersion, platform: 'darwin', env: {} })
    expect(third).not.toBe(first)
    await third
  })

  it('never throws when the exec boundary fails', async () => {
    const exec: ExecLoginShell = async () => { throw new Error('shell exploded') }
    const entries = await detectToolchain({ exec, execVersion: noVersion, platform: 'darwin', env: {} })
    expect(entries.every(entry => !entry.installed)).toBe(true)
  })
})

describe('resolveInterpreter', () => {
  it('resolves by catalog id and by binary basename, case-insensitively', async () => {
    const exec = execReturning({ Rscript: { stdout: '/opt/homebrew/bin/Rscript\n', exitCode: 0 } })
    resetToolchainDetection()
    await detectToolchain({ exec, execVersion: noVersion, platform: 'darwin', env: {} })

    expect((await resolveInterpreter('rscript'))?.binPath).toBe('/opt/homebrew/bin/Rscript')
    expect((await resolveInterpreter('Rscript'))?.binPath).toBe('/opt/homebrew/bin/Rscript')
    expect((await resolveInterpreter('RSCRIPT.exe'))?.binPath).toBe('/opt/homebrew/bin/Rscript')
    expect(await resolveInterpreter('bash')).toBeNull()
  })

  it('returns null for interpreters that are not installed', async () => {
    const exec = execReturning({})
    resetToolchainDetection()
    await detectToolchain({ exec, execVersion: noVersion, platform: 'darwin', env: {} })
    expect(await resolveInterpreter('rscript')).toBeNull()
  })
})
