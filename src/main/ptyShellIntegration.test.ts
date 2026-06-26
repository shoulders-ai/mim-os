import * as nodePty from 'node-pty'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  preparePtyShellIntegration,
  zshIntegrationDir,
} from '@main/ptyShellIntegration.js'

describe('preparePtyShellIntegration', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  function tempDir(name: string): string {
    const dir = mkdtempSync(join(tmpdir(), `mim-${name}-`))
    dirs.push(dir)
    return dir
  }

  it('generates a zsh startup proxy and points scratch zsh at it when enabled', () => {
    const userDataDir = tempDir('userdata')
    const homeDir = tempDir('home')

    const result = preparePtyShellIntegration({
      enabled: true,
      file: '/bin/zsh',
      args: [],
      env: { HOME: homeDir, PATH: '/usr/bin' },
      userDataDir,
      platform: 'darwin',
    })

    const integrationDir = zshIntegrationDir(userDataDir)
    expect(result).toMatchObject({
      file: '/bin/zsh',
      args: [],
      env: {
        HOME: homeDir,
        PATH: '/usr/bin',
        ZDOTDIR: integrationDir,
        MIM_ORIGINAL_ZDOTDIR: homeDir,
        MIM_USER_ZDOTDIR_AFTER_ZSHENV: homeDir,
        MIM_ZSH_INTEGRATION_DIR: integrationDir,
        MIM_SHELL_INTEGRATION: 'zsh',
      },
    })

    const zshenv = readFileSync(join(integrationDir, '.zshenv'), 'utf8')
    const zshrc = readFileSync(join(integrationDir, '.zshrc'), 'utf8')
    expect(zshenv).toContain('source "${MIM_ORIGINAL_ZDOTDIR}/.zshenv"')
    expect(zshrc).toContain('source "${MIM_ORIGINAL_ZDOTDIR}/.zshrc"')
    expect(zshrc).toContain("$'\\e[1;3D' backward-word")
    expect(zshrc).toContain("$'\\e[1;3C' forward-word")
    expect(zshrc).toContain("$'\\e[1;4D' backward-word")
    expect(zshrc).toContain("$'\\e[1;4C' forward-word")
    expect(zshrc).toContain("$'\\e[1;2D' backward-char")
    expect(zshrc).toContain("$'\\e[1;2C' forward-char")
    expect(zshrc).toContain("'^A' beginning-of-line")
    expect(zshrc).toContain("'^E' end-of-line")
    expect(zshrc).toContain("'^W' backward-kill-word")
    expect(zshrc).toContain("$'\\eOH' beginning-of-line")
    expect(zshrc).toContain("$'\\e[4~' end-of-line")
  })

  it('uses the user ZDOTDIR as the original startup directory when present', () => {
    const userDataDir = tempDir('userdata')
    const homeDir = tempDir('home')
    const originalZdotdir = tempDir('zdotdir')

    const result = preparePtyShellIntegration({
      enabled: true,
      file: 'zsh',
      args: [],
      env: { HOME: homeDir, ZDOTDIR: originalZdotdir },
      userDataDir,
      platform: 'darwin',
    })

    expect(result.env.ZDOTDIR).toBe(zshIntegrationDir(userDataDir))
    expect(result.env.MIM_ORIGINAL_ZDOTDIR).toBe(originalZdotdir)
  })

  it('leaves non-scratch or non-zsh commands unchanged', () => {
    const userDataDir = tempDir('userdata')
    const unchanged = preparePtyShellIntegration({
      enabled: true,
      file: '/bin/zsh',
      args: ['-lc', 'echo ok'],
      env: { HOME: '/Users/me' },
      userDataDir,
      platform: 'darwin',
    })
    const nonZsh = preparePtyShellIntegration({
      enabled: true,
      file: '/bin/bash',
      args: [],
      env: { HOME: '/Users/me' },
      userDataDir,
      platform: 'darwin',
    })
    const disabled = preparePtyShellIntegration({
      enabled: false,
      file: '/bin/zsh',
      args: [],
      env: { HOME: '/Users/me' },
      userDataDir,
      platform: 'darwin',
    })

    expect(unchanged.env.ZDOTDIR).toBeUndefined()
    expect(nonZsh.env.ZDOTDIR).toBeUndefined()
    expect(disabled.env.ZDOTDIR).toBeUndefined()
    expect(existsSync(zshIntegrationDir(userDataDir))).toBe(false)
  })

  const itIfZsh = existsSync('/bin/zsh') ? it : it.skip

  itIfZsh('keeps xterm Option arrows and fallback control bytes working in zsh vi insert mode', async () => {
    const userDataDir = tempDir('userdata')
    const homeDir = tempDir('home')
    writeFileSync(join(homeDir, '.zshrc'), [
      'bindkey -v',
      'PROMPT="READY>"',
      'mim_accept_line() {',
      '  print -r -- ""',
      '  print -r -- "ACCEPTED:${BUFFER}"',
      '  BUFFER=":"',
      '  zle .accept-line',
      '}',
      'zle -N accept-line mim_accept_line',
      '',
    ].join('\n'))

    const prepared = preparePtyShellIntegration({
      enabled: true,
      file: '/bin/zsh',
      args: [],
      env: {
        HOME: homeDir,
        PATH: process.env.PATH,
        TERM: 'xterm-256color',
      },
      userDataDir,
      platform: 'darwin',
    })

    const pty = nodePty.spawn(prepared.file, prepared.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: homeDir,
      env: prepared.env,
    })

    let output = ''
    pty.onData((chunk) => { output += chunk })
    const exited = new Promise<void>((resolve) => {
      pty.onExit(() => resolve())
    })

    try {
      await waitForOutput(() => output.includes('READY>'))

      pty.write('hello world')
      pty.write('\x1b[1;3D')
      pty.write('X')
      pty.write('\r')
      await waitForOutput(() => output.includes('ACCEPTED:hello Xworld'))

      pty.write('hello world')
      pty.write('\x1b[1;3D')
      pty.write('\x1b[1;3C')
      pty.write('X')
      pty.write('\r')
      await waitForOutput(() => output.includes('ACCEPTED:hello worldX'))

      pty.write('hello world')
      pty.write('\x1b[1;4D')
      pty.write('X')
      pty.write('\r')
      await waitForOutput(() => output.includes('ACCEPTED:hello Xworld'))

      pty.write('abc')
      pty.write('\x01')
      pty.write('X')
      pty.write('\x05')
      pty.write('Y')
      pty.write('\r')
      await waitForOutput(() => output.includes('ACCEPTED:XabcY'))

      pty.write('abc def')
      pty.write('\x17')
      pty.write('\r')
      await waitForOutput(() => output.includes('ACCEPTED:abc '))
    } finally {
      pty.kill()
      await Promise.race([
        exited,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ])
    }
  }, 10000)
})

async function waitForOutput(predicate: () => boolean): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 3000) throw new Error('Timed out waiting for zsh pty output')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
