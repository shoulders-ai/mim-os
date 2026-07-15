import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createMemorySecretStore } from '@main/integrations/secrets.js'
import { enableRoutine, loadRoutineCatalog, routineWebhookSecretAccount } from './routines.js'
import { createRoutineAutomation } from './automation.js'

describe('routine automation', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-routine-automation-'))
    mkdirSync(join(dir, 'routines'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('fires an enabled interval routine once per due tick and advances nextRunAt', async () => {
    writeRoutine('pulse', [
      'trigger:',
      '  every: 10m',
      'missed: once',
    ])
    enable('pulse')
    const runRoutine = vi.fn(async () => ({ sessionId: 's1', routineRunId: 'rr1', status: 'done' as const }))
    const automation = createRoutineAutomation({
      getWorkspacePath: () => dir,
      runRoutine,
      now: () => new Date('2026-07-08T08:00:00.000Z'),
    })

    await automation.tick(new Date('2026-07-08T08:00:00.000Z'))
    expect(runRoutine).not.toHaveBeenCalled()

    await automation.tick(new Date('2026-07-08T08:10:00.000Z'))

    expect(runRoutine).toHaveBeenCalledOnce()
    expect(runRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pulse' }),
      expect.objectContaining({ trigger: 'schedule' }),
    )
    const listed = loadRoutineCatalog(dir).routines.find(routine => routine.id === 'pulse')
    expect(listed).toMatchObject({
      lastRunId: 'rr1',
      lastSuccessAt: expect.any(String),
      nextRunAt: '2026-07-08T08:20:00.000Z',
    })
  })

  it('ignores disabled file-triggered routines and fires enabled matching changes', async () => {
    writeRoutine('watch-inbox', [
      'trigger:',
      '  files:',
      '    path: inbox/',
      '    events: [add]',
    ])
    const runRoutine = vi.fn(async () => ({ sessionId: 's1', routineRunId: 'rr1', status: 'done' as const }))
    const automation = createRoutineAutomation({
      getWorkspacePath: () => dir,
      runRoutine,
      now: () => new Date('2026-07-08T09:00:00.000Z'),
    })

    await automation.handleFileChanges([{ path: 'inbox/a.csv', kind: 'add' }])
    expect(runRoutine).not.toHaveBeenCalled()

    enable('watch-inbox')
    await automation.handleFileChanges([{ path: 'notes/a.md', kind: 'add' }])
    await automation.handleFileChanges([{ path: 'inbox/a.csv', kind: 'change' }])
    expect(runRoutine).not.toHaveBeenCalled()

    await automation.handleFileChanges([{ path: 'inbox/a.csv', kind: 'add' }])

    expect(runRoutine).toHaveBeenCalledOnce()
    expect(runRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'watch-inbox' }),
      expect.objectContaining({
        trigger: 'files',
        payload: { files: [{ path: 'inbox/a.csv', kind: 'add' }] },
      }),
    )
  })

  it('starts file watchers at glob roots and routes matching watcher events', async () => {
    writeRoutine('watch-notes', [
      'trigger:',
      '  files:',
      '    path: inbox/*.md',
      '    events: [change]',
    ])
    enable('watch-notes')
    let onAll: ((event: string, path: string) => void) | undefined
    const close = vi.fn()
    const watch = vi.fn(() => ({
      on: vi.fn((_event: 'all', cb: (event: string, path: string) => void) => {
        onAll = cb
      }),
      close,
    }))
    const runRoutine = vi.fn(async () => ({ sessionId: 's1', routineRunId: 'rr1', status: 'done' as const }))
    const automation = createRoutineAutomation({
      getWorkspacePath: () => dir,
      runRoutine,
      watch,
      now: () => new Date('2026-07-08T09:00:00.000Z'),
    })

    await automation.start()
    expect(watch).toHaveBeenCalledWith(join(dir, 'inbox'), { ignoreInitial: true })

    onAll?.('change', join(dir, 'inbox', 'today.md'))
    await waitFor(() => runRoutine.mock.calls.length === 1)

    expect(runRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'watch-notes' }),
      expect.objectContaining({
        trigger: 'files',
        payload: { files: [{ path: 'inbox/today.md', kind: 'change' }] },
      }),
    )

    await automation.stop()
    expect(close).toHaveBeenCalledOnce()
  })

  it('accepts signed webhook deliveries once and rejects missing or replayed signatures', async () => {
    writeRoutine('intake', [
      'trigger:',
      '  webhook:',
      '    secret: intake',
    ])
    enable('intake')
    const secrets = createMemorySecretStore({
      [`Mim:${routineWebhookSecretAccount('intake')}`]: 'top-secret',
    })
    const runRoutine = vi.fn(async () => ({ sessionId: 's1', routineRunId: 'rr1', status: 'done' as const }))
    const automation = createRoutineAutomation({
      getWorkspacePath: () => dir,
      runRoutine,
      secrets,
      now: () => new Date('2026-07-08T09:00:00.000Z'),
    })
    const rawBody = Buffer.from(JSON.stringify({ record_id: 'trial-1' }))
    const timestamp = '1783501200'
    const signature = webhookSignature('top-secret', timestamp, rawBody)

    await expect(automation.handleWebhook('intake', {
      rawBody,
      body: { record_id: 'trial-1' },
      headers: {},
    })).resolves.toMatchObject({ status: 401 })

    await expect(automation.handleWebhook('intake', {
      rawBody,
      body: { record_id: 'trial-1' },
      headers: {
        'x-mim-timestamp': timestamp,
        'x-mim-signature': signature,
        'x-mim-delivery': 'delivery-1',
      },
    })).resolves.toMatchObject({ status: 202 })

    await expect(automation.handleWebhook('intake', {
      rawBody,
      body: { record_id: 'trial-1' },
      headers: {
        'x-mim-timestamp': timestamp,
        'x-mim-signature': signature,
        'x-mim-delivery': 'delivery-1',
      },
    })).resolves.toMatchObject({ status: 202, duplicate: true })

    expect(runRoutine).toHaveBeenCalledOnce()
    expect(runRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'intake' }),
      expect.objectContaining({
        trigger: 'webhook',
        payload: { body: { record_id: 'trial-1' }, deliveryId: 'delivery-1' },
      }),
    )
  })

  function writeRoutine(name: string, frontmatterLines: string[]) {
    writeFileSync(join(dir, 'routines', `${name}.md`), [
      '---',
      `name: ${name}`,
      ...frontmatterLines,
      '---',
      '',
      `Run ${name}.`,
    ].join('\n'))
  }

  function enable(name: string) {
    const routine = loadRoutineCatalog(dir).routines.find(item => item.id === name)
    if (!routine) throw new Error(`missing routine: ${name}`)
    enableRoutine(dir, routine)
  }
})

function webhookSignature(secret: string, timestamp: string, rawBody: Buffer): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(timestamp)
  hmac.update('.')
  hmac.update(rawBody)
  return `sha256=${hmac.digest('hex')}`
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for condition')
}
