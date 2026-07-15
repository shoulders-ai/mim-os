import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveBundledAgentResource } from '@main/agents/agentResources.js'

describe('resolveBundledAgentResource', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'mim-agent-resource-'))
    dirs.push(dir)
    return dir
  }

  it('resolves a development resource from the repository resources directory', () => {
    const cwd = tempDir()
    const resource = join(cwd, 'resources', 'pi', 'mim-extension.mjs')
    mkdirSync(join(cwd, 'resources', 'pi'), { recursive: true })
    writeFileSync(resource, 'export default () => {}')

    expect(resolveBundledAgentResource('pi/mim-extension.mjs', {
      cwd,
      moduleDir: '/missing/module',
      resourcesPath: '/missing/resources',
    })).toBe(resource)
  })

  it('maps packaged resources to app.asar.unpacked for spawned CLI processes', () => {
    const resourcesPath = join(tempDir(), 'Mim.app', 'Contents', 'Resources')
    const unpacked = join(resourcesPath, 'app.asar.unpacked', 'resources', 'pi', 'mim-extension.mjs')
    mkdirSync(join(unpacked, '..'), { recursive: true })
    writeFileSync(unpacked, 'export default () => {}')

    expect(resolveBundledAgentResource('pi/mim-extension.mjs', {
      cwd: '/missing/cwd',
      moduleDir: join(resourcesPath, 'app.asar', 'out', 'main', 'chunks'),
      resourcesPath,
    })).toBe(unpacked)
  })

  it('returns null when a bundled resource cannot be found', () => {
    expect(resolveBundledAgentResource('pi/missing.mjs', {
      cwd: '/missing/cwd',
      moduleDir: '/missing/module',
      resourcesPath: '/missing/resources',
    })).toBeNull()
  })

  it('rejects absolute and parent-traversing resource paths', () => {
    expect(() => resolveBundledAgentResource('/tmp/extension.mjs')).toThrow('relative')
    expect(() => resolveBundledAgentResource('../extension.mjs')).toThrow('relative')
  })
})
