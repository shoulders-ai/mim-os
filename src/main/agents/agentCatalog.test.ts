import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AGENT_CATALOG,
  detectAgents,
  resetAgentDetection,
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
  it('lists exactly claude-code, codex, and gemini-cli with their binaries', () => {
    expect(AGENT_CATALOG).toEqual([
      { id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [] },
      { id: 'codex', name: 'Codex', bin: 'codex', args: [] },
      { id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', args: [] },
    ])
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
