import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AGENT_CATALOG,
  detectAgents,
  resetAgentDetection,
  launchArgs,
  resumeArgs,
  assertAgentExtraArgs,
  cliSessionsDir,
  extractCodexSessionId,
  type DetectedAgent,
  type ExecLoginShell,
} from '@main/agents/agentCatalog.js'

function execReturning(map: Record<string, { stdout: string; exitCode: number }>) {
  return vi.fn<ExecLoginShell>(async (_shell, args) => {
    const command = args[args.length - 1]
    for (const [bin, result] of Object.entries(map)) {
      if (command === bin || command.includes(`command -v ${bin}`)) return result
    }
    return { stdout: '', exitCode: 1 }
  })
}

describe('agent catalog', () => {
  it('lists Claude Code, Codex, Gemini CLI, and Pi with their capabilities', () => {
    expect(AGENT_CATALOG).toEqual([
      { id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [] },
      { id: 'codex', name: 'Codex', bin: 'codex', args: [] },
      { id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', args: [] },
      {
        id: 'pi',
        name: 'Pi',
        bin: 'pi',
        args: [],
        minimumVersion: '0.76.0',
        mimToolConnection: 'extension',
        extensionResource: 'pi/mim-extension.mjs',
      },
    ])
  })
})

describe('launchArgs', () => {
  it('pins Pi to the Mim session id while preserving custom flags', () => {
    expect(launchArgs(
      'pi',
      'mim-session-123',
      ['--model', 'anthropic/claude-sonnet-4'],
      ['--extension', '/bundled/mim-extension.mjs'],
    )).toEqual([
      '--session-id',
      'mim-session-123',
      '--model',
      'anthropic/claude-sonnet-4',
      '--extension',
      '/bundled/mim-extension.mjs',
    ])
  })

  it('leaves other agent launch flags unchanged', () => {
    expect(launchArgs('codex', 'mim-session-123', ['--full-auto'])).toEqual(['--full-auto'])
  })
})

describe('resumeArgs', () => {
  it('returns --resume <cliSessionId> for claude-code when detected', () => {
    expect(resumeArgs('claude-code', 'cc-uuid-456')).toEqual(['--resume', 'cc-uuid-456'])
  })

  it('falls back to --continue for claude-code when no cliSessionId', () => {
    expect(resumeArgs('claude-code')).toEqual(['--continue'])
  })

  it('returns resume <cliSessionId> for codex when detected', () => {
    expect(resumeArgs('codex', 'codex-uuid-789')).toEqual(['resume', 'codex-uuid-789'])
  })

  it('falls back to resume --last for codex when no cliSessionId', () => {
    expect(resumeArgs('codex')).toEqual(['resume', '--last'])
  })

  it('returns --session-file for gemini-cli when cliSessionId and cwd provided', () => {
    const home = process.env.HOME || ''
    const result = resumeArgs('gemini-cli', 'session-2026-06-25T13-45-abc12345', '/Users/waqr/Desktop/mim-os')
    expect(result).toEqual(['--session-file', `${home}/.gemini/tmp/mim-os/chats/session-2026-06-25T13-45-abc12345.jsonl`])
  })

  it('falls back to --resume latest for gemini-cli when no cliSessionId', () => {
    expect(resumeArgs('gemini-cli')).toEqual(['--resume', 'latest'])
  })

  it('resumes Pi by exact session id and restores its custom flags', () => {
    expect(resumeArgs(
      'pi',
      'mim-session-123',
      '/workspace',
      ['--model', 'openai/gpt-5'],
      ['--extension', '/bundled/mim-extension.mjs'],
    )).toEqual([
      '--session-id',
      'mim-session-123',
      '--model',
      'openai/gpt-5',
      '--extension',
      '/bundled/mim-extension.mjs',
    ])
  })

  it('returns empty for unknown agents', () => {
    expect(resumeArgs('unknown')).toEqual([])
  })
})

describe('assertAgentExtraArgs', () => {
  it('reserves Pi session-control flags for Mim', () => {
    for (const flag of ['--session-id', '--session', '--continue', '-c', '--resume', '-r', '--no-session', '--fork']) {
      expect(() => assertAgentExtraArgs('pi', [flag])).toThrow(`Pi flag ${flag} is managed by Mim`)
    }
  })

  it('allows ordinary Pi flags and does not constrain other agents', () => {
    expect(() => assertAgentExtraArgs('pi', ['--model', 'openai/gpt-5'])).not.toThrow()
    expect(() => assertAgentExtraArgs('codex', ['--resume', 'anything'])).not.toThrow()
  })
})

describe('cliSessionsDir', () => {
  it('returns Claude Code project sessions path', () => {
    const home = process.env.HOME || ''
    expect(cliSessionsDir('claude-code', '/Users/waqr/Desktop/mim-os'))
      .toBe(`${home}/.claude/projects/-Users-waqr-Desktop-mim-os`)
  })

  it('returns Gemini sessions path using basename of cwd', () => {
    const home = process.env.HOME || ''
    expect(cliSessionsDir('gemini-cli', '/Users/waqr/Desktop/mim-os'))
      .toBe(`${home}/.gemini/tmp/mim-os/chats`)
  })

  it('returns null for codex (date-based, computed at snapshot time)', () => {
    expect(cliSessionsDir('codex', '/workspace')).toBeNull()
  })
})

describe('extractCodexSessionId', () => {
  it('extracts UUID from codex session filename', () => {
    expect(extractCodexSessionId('rollout-2026-06-28T17-12-01-019f0ec9-9bf9-73f0-8d38-9f98d67a8668.jsonl'))
      .toBe('019f0ec9-9bf9-73f0-8d38-9f98d67a8668')
  })

  it('returns undefined for non-matching filenames', () => {
    expect(extractCodexSessionId('something-else.jsonl')).toBeUndefined()
  })
})

describe('detectAgents', () => {
  beforeEach(() => {
    resetAgentDetection()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    resetAgentDetection()
  })

  it('marks an agent installed and captures the absolute binary path', async () => {
    const exec = execReturning({
      claude: { stdout: '/opt/homebrew/bin/claude\n', exitCode: 0 },
    })
    const agents = await detectAgents({ exec })

    const claude = agents.find(a => a.id === 'claude-code') as DetectedAgent
    expect(claude.installed).toBe(true)
    expect(claude.binPath).toBe('/opt/homebrew/bin/claude')
  })

  it('marks an agent not installed on non-zero exit, with no binPath', async () => {
    const exec = execReturning({
      claude: { stdout: '', exitCode: 1 },
    })
    const agents = await detectAgents({ exec })

    const claude = agents.find(a => a.id === 'claude-code') as DetectedAgent
    expect(claude.installed).toBe(false)
    expect(claude.binPath).toBeUndefined()
  })

  it('marks an agent not installed on empty output even with exit 0', async () => {
    const exec = execReturning({
      codex: { stdout: '  \n', exitCode: 0 },
    })
    const agents = await detectAgents({ exec })

    const codex = agents.find(a => a.id === 'codex') as DetectedAgent
    expect(codex.installed).toBe(false)
    expect(codex.binPath).toBeUndefined()
  })

  it('rejects non-absolute output (alias/function noise) as not installed', async () => {
    const exec = execReturning({
      gemini: { stdout: 'gemini: aliased to npx gemini\n', exitCode: 0 },
    })
    const agents = await detectAgents({ exec })

    const gemini = agents.find(a => a.id === 'gemini-cli') as DetectedAgent
    expect(gemini.installed).toBe(false)
    expect(gemini.binPath).toBeUndefined()
  })

  it('treats a throwing exec as not installed and still resolves all agents', async () => {
    const exec = vi.fn<ExecLoginShell>(async () => {
      throw new Error('spawn failed')
    })
    const agents = await detectAgents({ exec })

    expect(agents).toHaveLength(AGENT_CATALOG.length)
    for (const agent of agents) {
      expect(agent.installed).toBe(false)
      expect(agent.binPath).toBeUndefined()
    }
  })

  it('returns one entry per catalog agent, in catalog order, carrying definition fields', async () => {
    const exec = execReturning({})
    const agents = await detectAgents({ exec })

    expect(agents.map(a => a.id)).toEqual(AGENT_CATALOG.map(d => d.id))
    expect(agents.map(a => a.bin)).toEqual(AGENT_CATALOG.map(d => d.bin))
    expect(agents.map(a => a.args)).toEqual(AGENT_CATALOG.map(d => d.args))
  })

  it('resolves POSIX binaries through a login shell: $SHELL -lic "command -v <bin>"', async () => {
    vi.stubEnv('SHELL', '/bin/test-shell')
    const exec = execReturning({})
    await detectAgents({ exec })

    expect(exec).toHaveBeenCalledTimes(AGENT_CATALOG.length)
    for (const def of AGENT_CATALOG) {
      expect(exec).toHaveBeenCalledWith('/bin/test-shell', ['-lic', `command -v ${def.bin}`])
    }
  })

  it('falls back to /bin/zsh on macOS when SHELL is unset', async () => {
    vi.stubEnv('SHELL', '')
    const exec = execReturning({})
    await detectAgents({ exec, platform: 'darwin' })

    for (const call of exec.mock.calls) {
      expect(call[0]).toBe('/bin/zsh')
    }
  })

  it('falls back to /bin/sh with non-interactive flags on Linux when SHELL is unset', async () => {
    vi.stubEnv('SHELL', '')
    const exec = execReturning({})
    await detectAgents({ exec, platform: 'linux' })

    for (const [file, args] of exec.mock.calls) {
      expect(file).toBe('/bin/sh')
      expect(args[0]).toBe('-lc')
    }
  })

  it('resolves Windows .cmd shims through where.exe', async () => {
    const exec = execReturning({
      codex: { stdout: 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd\r\n', exitCode: 0 },
    })
    const agents = await detectAgents({ exec, platform: 'win32' })

    expect(exec).toHaveBeenCalledWith('where.exe', ['codex'])
    const codex = agents.find(a => a.id === 'codex') as DetectedAgent
    expect(codex.installed).toBe(true)
    expect(codex.binPath).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd')
  })

  it('captures the installed Pi version and marks supported versions compatible', async () => {
    const exec = vi.fn<ExecLoginShell>(async (file, args) => {
      const command = args.at(-1) ?? ''
      if (command.includes('command -v pi')) return { stdout: '/opt/homebrew/bin/pi\n', exitCode: 0 }
      if (file === '/opt/homebrew/bin/pi' && command === '--version') {
        return { stdout: 'pi 0.80.6\n', exitCode: 0 }
      }
      return { stdout: '', exitCode: 1 }
    })

    const agents = await detectAgents({ exec })
    const pi = agents.find(agent => agent.id === 'pi') as DetectedAgent

    expect(pi).toMatchObject({
      installed: true,
      binPath: '/opt/homebrew/bin/pi',
      version: '0.80.6',
      compatible: true,
    })
    expect(pi.compatibilityMessage).toBeUndefined()
    expect(exec).toHaveBeenCalledWith('/opt/homebrew/bin/pi', ['--version'])
  })

  it('keeps old Pi installations visible but marks them unavailable', async () => {
    const exec = vi.fn<ExecLoginShell>(async (file, args) => {
      const command = args.at(-1) ?? ''
      if (command.includes('command -v pi')) return { stdout: '/usr/local/bin/pi\n', exitCode: 0 }
      if (file === '/usr/local/bin/pi' && command === '--version') {
        return { stdout: '0.75.5\n', exitCode: 0 }
      }
      return { stdout: '', exitCode: 1 }
    })

    const agents = await detectAgents({ exec })
    const pi = agents.find(agent => agent.id === 'pi') as DetectedAgent

    expect(pi).toMatchObject({ installed: true, version: '0.75.5', compatible: false })
    expect(pi.compatibilityMessage).toBe('Pi 0.75.5 found; version 0.76.0 or newer is required')
  })

  it('marks Pi unavailable when its installed version cannot be verified', async () => {
    const exec = vi.fn<ExecLoginShell>(async (_file, args) => {
      const command = args.at(-1) ?? ''
      if (command.includes('command -v pi')) return { stdout: '/usr/local/bin/pi\n', exitCode: 0 }
      return { stdout: 'unknown\n', exitCode: 0 }
    })

    const agents = await detectAgents({ exec })
    const pi = agents.find(agent => agent.id === 'pi') as DetectedAgent

    expect(pi).toMatchObject({ installed: true, compatible: false })
    expect(pi.version).toBeUndefined()
    expect(pi.compatibilityMessage).toBe('Could not verify Pi version; version 0.76.0 or newer is required')
  })

  it('checks a Windows Pi shim version through cmd.exe', async () => {
    const piPath = 'C:\\Users\\me\\AppData\\Roaming\\npm\\pi.cmd'
    const exec = vi.fn<ExecLoginShell>(async (file, args) => {
      if (file === 'where.exe' && args[0] === 'pi') return { stdout: `${piPath}\r\n`, exitCode: 0 }
      if (file === 'cmd.exe') return { stdout: 'pi 0.80.6\r\n', exitCode: 0 }
      return { stdout: '', exitCode: 1 }
    })

    const agents = await detectAgents({ exec, platform: 'win32' })
    const pi = agents.find(agent => agent.id === 'pi') as DetectedAgent

    expect(pi).toMatchObject({ installed: true, version: '0.80.6', compatible: true })
    expect(exec).toHaveBeenCalledWith('cmd.exe', ['/d', '/s', '/c', `"${piPath}" --version`])
  })

  it('caches detection: a second call does not re-invoke exec', async () => {
    const exec = execReturning({
      claude: { stdout: '/usr/local/bin/claude\n', exitCode: 0 },
    })
    const first = await detectAgents({ exec })
    const second = await detectAgents({ exec })

    expect(exec).toHaveBeenCalledTimes(AGENT_CATALOG.length)
    expect(second).toEqual(first)
  })

  it('resetAgentDetection clears the cache so exec runs again', async () => {
    const exec = execReturning({})
    await detectAgents({ exec })
    resetAgentDetection()
    await detectAgents({ exec })

    expect(exec).toHaveBeenCalledTimes(AGENT_CATALOG.length * 2)
  })
})
