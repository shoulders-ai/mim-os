import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
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

  it('creates, lists, gets, updates, duplicates, enables, and disables routine definitions', async () => {
    const onChange = vi.fn()
    registerRoutineTools(tools, { onChange })

    const created = await tools.call('routine.create', {
      name: 'standup',
      description: 'Draft standup note.',
      trigger: { every: '4h' },
      body: 'Read the board and draft a note.',
      tools: ['fs.read'],
      approval: { allow: ['fs.read'] },
    }, { actor: 'user' }) as { routine: { revision: string } }

    let listed = await tools.call('routine.list', {}, { actor: 'user' }) as {
      routines: Array<{ id: string; activation: string; revision: string }>
      diagnostics: unknown[]
    }
    expect(listed.diagnostics).toEqual([])
    expect(listed.routines).toEqual([
      expect.objectContaining({ id: 'standup', activation: 'review-required' }),
    ])

    await tools.call('routine.enable', { name: 'standup' }, { actor: 'user' })
    listed = await tools.call('routine.list', {}, { actor: 'user' }) as typeof listed
    expect(listed.routines[0]).toMatchObject({ activation: 'active' })

    const got = await tools.call('routine.get', { name: 'standup' }, { actor: 'user' }) as {
      routine: { body: string; approvalAllow: string[]; revision: string }
    }
    expect(got.routine.body).toBe('Read the board and draft a note.')
    expect(got.routine.approvalAllow).toEqual(['fs.read'])

    const updated = await tools.call('routine.update', {
      name: 'standup',
      expectedRevision: got.routine.revision,
      description: 'Draft a concise standup note.',
      trigger: { every: '4h' },
      body: 'Read the board and draft a concise note.',
      tools: ['fs.read'],
      approvalAllow: ['fs.read'],
    }, { actor: 'user' }) as { routine: { body: string; activation: string } }
    expect(updated.routine).toMatchObject({
      body: 'Read the board and draft a concise note.',
      activation: 'active',
    })

    const duplicate = await tools.call('routine.duplicate', {
      name: 'standup',
      newName: 'standup-copy',
    }, { actor: 'user' }) as { routine: { id: string; activation: string } }
    expect(duplicate.routine).toMatchObject({ id: 'standup-copy', activation: 'review-required' })

    await tools.call('routine.disable', { name: 'standup' }, { actor: 'user' })
    listed = await tools.call('routine.list', {}, { actor: 'user' }) as typeof listed
    expect(listed.routines.find(item => item.id === 'standup')).toMatchObject({ activation: 'disabled' })
    expect(tools.get('routine.pause')).toBeUndefined()
    expect(tools.get('routine.resume')).toBeUndefined()
    expect(onChange).toHaveBeenCalledTimes(5)
    expect(created.routine.revision).toMatch(/^[a-f0-9]{64}$/)
  })

  it('moves routine definitions to trash, clears state, and preserves the high-level result', async () => {
    const trash = vi.fn(async (params: Record<string, unknown>) => {
      rmSync(join(dir, String(params.path)), { force: true })
      return { trashed: params.path }
    })
    tools.register({ name: 'fs.trash', description: 'trash', execute: trash })
    registerRoutineTools(tools)
    await tools.call('routine.create', {
      name: 'pulse',
      trigger: { every: '4h' },
      body: 'Check the project pulse.',
    }, { actor: 'user' })
    await tools.call('routine.enable', { name: 'pulse' }, { actor: 'user' })

    const removed = await tools.call('routine.remove', { name: 'pulse' }, { actor: 'user' })

    expect(removed).toEqual({ removed: 'pulse', path: 'routines/pulse.md' })
    expect(trash).toHaveBeenCalledWith({ path: 'routines/pulse.md' }, expect.objectContaining({ actor: 'user' }))
    expect(existsSync(join(dir, 'routines', 'pulse.md'))).toBe(false)
    const listed = await tools.call('routine.list', {}, { actor: 'user' }) as { routines: unknown[] }
    expect(listed.routines).toEqual([])
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

  it('manual start returns the routine session immediately and delegates to the starter', async () => {
    const startRoutine = vi.fn(async () => ({
      sessionId: 'session_routine',
      routineRunId: 'routine_run_1',
      status: 'working' as const,
    }))
    registerRoutineTools(tools, { startRoutine })

    await tools.call('routine.create', {
      name: 'draft',
      description: 'Draft note.',
      body: 'Draft the note.',
    }, { actor: 'user' })

    const result = await tools.call('routine.start', { name: 'draft' }, { actor: 'user' })

    expect(result).toEqual({
      sessionId: 'session_routine',
      routineRunId: 'routine_run_1',
      status: 'working',
    })
    expect(startRoutine).toHaveBeenCalledWith(
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
