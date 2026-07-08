import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import { routineWebhookSecretAccount } from '@main/routines/routines.js'
import { registerRoutineTools } from './routines.js'

describe('routine tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-routine-tools-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    tools.register({
      name: 'fs.read',
      description: 'read',
      execute: async () => ({ content: '' }),
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('creates, lists, gets, pauses, and resumes routine definitions', async () => {
    registerRoutineTools(tools)

    await tools.call('routine.create', {
      name: 'standup',
      description: 'Draft standup note.',
      body: 'Read the board and draft a note.',
      tools: ['fs.read'],
      approval: { allow: ['fs.read'] },
    }, { actor: 'user' })

    let listed = await tools.call('routine.list', {}, { actor: 'user' }) as {
      routines: Array<{ id: string; enabled: boolean; needsEnablement: boolean }>
      diagnostics: unknown[]
    }
    expect(listed.diagnostics).toEqual([])
    expect(listed.routines).toEqual([
      expect.objectContaining({ id: 'standup', enabled: false, needsEnablement: true }),
    ])

    await tools.call('routine.resume', { name: 'standup' }, { actor: 'user' })
    listed = await tools.call('routine.list', {}, { actor: 'user' }) as typeof listed
    expect(listed.routines[0]).toMatchObject({ enabled: true, needsEnablement: false })

    const got = await tools.call('routine.get', { name: 'standup' }, { actor: 'user' }) as {
      routine: { body: string; approvalAllow: string[] }
    }
    expect(got.routine.body).toBe('Read the board and draft a note.')
    expect(got.routine.approvalAllow).toEqual(['fs.read'])

    await tools.call('routine.pause', { name: 'standup' }, { actor: 'user' })
    listed = await tools.call('routine.list', {}, { actor: 'user' }) as typeof listed
    expect(listed.routines[0]).toMatchObject({ enabled: false, paused: true })
  })

  it('manual run is allowed for disabled routines and delegates to the runner', async () => {
    const runRoutine = vi.fn(async () => ({
      sessionId: 'session_routine',
      routineRunId: 'routine_run_1',
      status: 'done' as const,
    }))
    registerRoutineTools(tools, { runRoutine })

    await tools.call('routine.create', {
      name: 'draft',
      description: 'Draft note.',
      body: 'Draft the note.',
    }, { actor: 'user' })

    const result = await tools.call('routine.run', { name: 'draft' }, { actor: 'user' })

    expect(result).toEqual({
      sessionId: 'session_routine',
      routineRunId: 'routine_run_1',
      status: 'done',
    })
    expect(runRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft', body: 'Draft the note.' }),
      expect.objectContaining({ trigger: 'manual' }),
    )
  })

  it('manages webhook signing secrets without exposing secret values', async () => {
    const secrets = createMemorySecretStore()
    registerRoutineTools(tools, { secrets })

    await tools.call('routine.create', {
      name: 'incoming-report',
      trigger: { webhook: { secret: 'reports' } },
      body: 'Summarize the incoming report.',
    }, { actor: 'user' })

    const empty = await tools.call('routine.webhook.secret.status', { name: 'incoming-report' }, { actor: 'user' })
    expect(empty).toEqual({ routine: 'incoming-report', secret: 'reports', configured: false })

    const set = await tools.call('routine.webhook.secret.set', {
      name: 'incoming-report',
      secret: 'local-signing-secret',
    }, { actor: 'user' })
    expect(set).toEqual({ routine: 'incoming-report', secret: 'reports', configured: true })
    expect(JSON.stringify(set)).not.toContain('local-signing-secret')
    expect(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${routineWebhookSecretAccount('reports')}`]).toBe('local-signing-secret')

    const configured = await tools.call('routine.webhook.secret.status', { name: 'incoming-report' }, { actor: 'user' })
    expect(configured).toEqual({ routine: 'incoming-report', secret: 'reports', configured: true })

    const deleted = await tools.call('routine.webhook.secret.delete', { name: 'incoming-report' }, { actor: 'user' })
    expect(deleted).toEqual({ routine: 'incoming-report', secret: 'reports', configured: false, deleted: true })
    expect(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${routineWebhookSecretAccount('reports')}`]).toBeUndefined()
  })
})
