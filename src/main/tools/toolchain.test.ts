import { describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerToolchainTools } from '@main/tools/toolchain.js'
import { resetToolchainDetection, type ExecLoginShell, type ExecVersion } from '@main/toolchain/toolchain.js'

describe('toolchain.status tool', () => {
  it('registers and returns entries with injected deps', async () => {
    resetToolchainDetection()

    const exec: ExecLoginShell = vi.fn(async (_file, args) => {
      const cmd = args[args.length - 1]
      if (cmd.includes('command -v R')) return { stdout: '/usr/bin/R\n', exitCode: 0 }
      return { stdout: '', exitCode: 1 }
    })
    const execVersion: ExecVersion = async () => 'R version 4.4.1\n'

    const tools = createToolRegistry(createTraceLog())
    registerToolchainTools(tools, { exec, execVersion, platform: 'darwin', env: {} })

    const result = await tools.call('toolchain.status', {}, { actor: 'user' }) as { entries: unknown[] }

    expect(result).toHaveProperty('entries')
    expect(Array.isArray(result.entries)).toBe(true)
    expect(result.entries.length).toBe(5)

    const r = (result.entries as Array<{ id: string; installed: boolean }>).find(e => e.id === 'r')
    expect(r?.installed).toBe(true)

    resetToolchainDetection()
  })

  it('is listed in the registry', () => {
    const tools = createToolRegistry(createTraceLog())
    registerToolchainTools(tools)
    expect(tools.get('toolchain.status')).toBeDefined()
  })
})
