import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock the AI boundary so we can assert the runtime delegates correctly without
// network or keys. Only the four functions packageRuntime imports are needed.
const { callModelToolLoop, callAnthropicToolLoop, callGeminiText, generateObjectWithAi } = vi.hoisted(() => ({
  callModelToolLoop: vi.fn(async () => ({ text: 'ok', usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } })),
  callAnthropicToolLoop: vi.fn(async () => ({ text: 'a' })),
  callGeminiText: vi.fn(async () => ({ text: 'g' })),
  generateObjectWithAi: vi.fn(async () => ({ object: {} })),
}))
vi.mock('@main/ai/ai.js', () => ({ callModelToolLoop, callAnthropicToolLoop, callGeminiText, generateObjectWithAi }))

import { createTraceLog } from '@main/trace/trace.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import { createPackageRuntime } from '@main/packages/packageRuntime.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { PackagePermissionError } from '@main/packages/packageErrors.js'

describe('package runtime ctx.ai.callModel wiring (Phase A)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-ai-wiring-'))
    mkdirSync(join(dir, 'packages'), { recursive: true })
    callModelToolLoop.mockClear()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function writePackage(id: string, permissions: Record<string, unknown>): void {
    const pkgDir = join(dir, 'packages', id)
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>x</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), 'export const jobs = {}')
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: `@mim/${id}`, version: '0.1.0', type: 'module',
      mim: { manifestVersion: 1, id, name: id, views: [], backend: './backend/index.mjs', permissions },
    }))
  }

  async function makeRuntime() {
    const trace = createTraceLog()
    const tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)
    const packages = await createPackageLoader(tools)
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    const runtime = createPackageRuntime({ packages, enablement, tools, trace })
    return { runtime, packages }
  }

  it('A29 ctx.ai.callModel delegates to callModelToolLoop with the job signal injected', async () => {
    writePackage('haspkg', { ai: true })
    const { runtime, packages } = await makeRuntime()
    const controller = new AbortController()
    const ctx = runtime.createContext({ pkg: packages.get('haspkg')!, signal: controller.signal })
    await ctx.ai.callModel({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], maxSteps: 5 })
    expect(callModelToolLoop).toHaveBeenCalledTimes(1)
    const arg = callModelToolLoop.mock.calls[0][0]
    expect(arg.modelId).toBe('claude-sonnet-4-6')
    expect(arg.maxSteps).toBe(5)
    expect(arg.signal).toBe(controller.signal)
  })

  it('A30 a package without permissions.ai cannot call callModel (gate before the loop)', async () => {
    writePackage('nopkg', { workspace: { read: true } })
    const { runtime, packages } = await makeRuntime()
    const ctx = runtime.createContext({ pkg: packages.get('nopkg')! })
    await expect(ctx.ai.callModel({ messages: [] })).rejects.toBeInstanceOf(PackagePermissionError)
    expect(callModelToolLoop).not.toHaveBeenCalled()
  })

  it('A31 additive guarantee: callAnthropic / callGemini / generateObject still present', async () => {
    writePackage('haspkg', { ai: true })
    const { runtime, packages } = await makeRuntime()
    const ctx = runtime.createContext({ pkg: packages.get('haspkg')! })
    expect(typeof ctx.ai.callAnthropic).toBe('function')
    expect(typeof ctx.ai.callGemini).toBe('function')
    expect(typeof ctx.ai.generateObject).toBe('function')
    expect(typeof ctx.ai.callModel).toBe('function')
  })
})
