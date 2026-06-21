import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createMemorySecretStore } from '@main/integrations/secrets.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerPackageRuntimeTools } from '@main/tools/packageRuntime.js'

describe('app runtime tools', () => {
  function makeTools(packageDir = '/tmp/self') {
    const tools = createToolRegistry(createTraceLog())
    const runtime = {
      invalidate: vi.fn(),
      listCapabilities: vi.fn(async () => []),
      listChatTools: vi.fn(async () => []),
      executeTool: vi.fn(),
    }
    const jobs = {
      start: vi.fn(async () => ({ runId: 'run-1', status: 'running' })),
      cancel: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => []),
      rename: vi.fn((runId: string, label: string) => ({ runId, label })),
      archive: vi.fn((runId: string, archived = true) => ({ runId, archived })),
      delete: vi.fn((runId: string) => ({ deleted: runId })),
    }
    const packages = {
      get: vi.fn(() => ({
        manifest: { id: 'self', name: 'Self', version: '0.1.0', views: [], permissions: { secrets: ['api_token'] } },
        dir: packageDir,
        source: 'workspace',
      })),
      list: vi.fn(() => []),
      diagnostics: vi.fn(() => []),
      onChange: vi.fn(),
      rescan: vi.fn(),
    }
    const enablement = {
      isEnabled: vi.fn(() => true),
      setEnabled: vi.fn(),
      diagnostics: vi.fn(() => []),
    }
    const secretStore = createMemorySecretStore()
    registerPackageRuntimeTools(tools, packages as any, runtime as any, jobs as any, { secretStore })
    return { tools, jobs, packages, runtime, secretStore }
  }

  it('lists filesystem app skills in app capabilities', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-package-skill-tool-'))
    try {
      const skillDir = join(dir, 'skills', 'review-work')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        'name: review-work',
        'description: Use when reviewing work.',
        '---',
        '',
        '# Review Work',
      ].join('\n'))
      const { tools, runtime } = makeTools(dir)
      runtime.listCapabilities.mockResolvedValue([{
        packageId: 'self',
        jobs: [],
        tools: [],
        diagnostics: [],
      }])

      const result = await tools.call('package.capabilities.list', {}, { actor: 'user' }) as { packages: Array<{ skills: Array<{ id: string; label: string }> }> }

      expect(result.packages[0].skills).toEqual([{ id: 'review-work', label: 'review-work' }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts app jobs with the authenticated app identity', async () => {
    const { tools, jobs } = makeTools()

    await tools.call('package.jobs.start', { jobId: 'inspect', inputs: { x: 1 } }, {
      actor: 'package',
      package_id: 'self',
    })

    expect(jobs.start).toHaveBeenCalledWith('self', 'inspect', { x: 1 })
  })

  it('rejects cross-app job starts from app UI', async () => {
    const { tools, jobs } = makeTools()

    await expect(
      tools.call('package.jobs.start', { packageId: 'other', jobId: 'inspect' }, {
        actor: 'package',
        package_id: 'self',
      }),
    ).rejects.toThrow('authenticated app identity')

    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('passes app job archive and delete lifecycle calls to the runner', async () => {
    const { tools, jobs } = makeTools()

    await expect(tools.call('package.jobs.archive', { runId: 'run-1' }, { actor: 'user' }))
      .resolves.toEqual({ run: { runId: 'run-1', archived: true } })
    await expect(tools.call('package.jobs.restore', { runId: 'run-1' }, { actor: 'user' }))
      .resolves.toEqual({ run: { runId: 'run-1', archived: false } })
    await expect(tools.call('package.jobs.delete', { runId: 'run-1' }, { actor: 'user' }))
      .resolves.toEqual({ deleted: 'run-1' })

    expect(jobs.archive).toHaveBeenCalledWith('run-1', true)
    expect(jobs.archive).toHaveBeenCalledWith('run-1', false)
    expect(jobs.delete).toHaveBeenCalledWith('run-1')
  })

  it('passes app job rename calls to the runner', async () => {
    const { tools, jobs } = makeTools()

    await expect(tools.call('package.jobs.rename', { runId: 'run-1', label: 'Renamed run' }, { actor: 'user' }))
      .resolves.toEqual({ run: { runId: 'run-1', label: 'Renamed run' } })

    expect(jobs.rename).toHaveBeenCalledWith('run-1', 'Renamed run')
  })

  it('stores, reports, and deletes declared app secrets without ever returning values', async () => {
    const { tools, secretStore } = makeTools()
    const ctx = { actor: 'package' as const, package_id: 'self' }

    await expect(tools.call('package.secrets.set', { name: 'api_token', secret: 'ghp_abc' }, ctx))
      .resolves.toEqual({ ok: true })
    expect(await secretStore.get('Mim', 'package:self:api_token')).toBe('ghp_abc')

    await expect(tools.call('package.secrets.status', {}, ctx))
      .resolves.toEqual({ secrets: [{ name: 'api_token', exists: true }] })

    await expect(tools.call('package.secrets.delete', { name: 'api_token' }, ctx))
      .resolves.toEqual({ ok: true })
    expect(await secretStore.get('Mim', 'package:self:api_token')).toBeNull()
    await expect(tools.call('package.secrets.status', {}, ctx))
      .resolves.toEqual({ secrets: [{ name: 'api_token', exists: false }] })
  })

  it('rejects undeclared secret names from app secret tools', async () => {
    const { tools } = makeTools()

    await expect(tools.call('package.secrets.set', { name: 'other', secret: 'x' }, { actor: 'package', package_id: 'self' }))
      .rejects.toThrow('did not declare secret')
  })

  it('requires app identity for app secret tools', async () => {
    const { tools } = makeTools()

    await expect(tools.call('package.secrets.set', { name: 'api_token', secret: 'x' }, { actor: 'user' }))
      .rejects.toThrow('App secret tools require app identity')
  })

  it('exposes no secret-value read tool', async () => {
    const { tools } = makeTools()

    await expect(tools.call('package.secrets.get', { name: 'api_token' }, { actor: 'package', package_id: 'self' }))
      .rejects.toThrow()
  })
})
