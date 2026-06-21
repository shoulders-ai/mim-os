import { describe, expect, it } from 'vitest'
import {
  activeRunForJob,
  defaultInputForSchema,
  jobInputSummary,
  latestRunActivity,
  latestRunProgress,
  packageRunEventLabel,
  parseJobInputText,
  runDurationLabel,
} from './packageManagerLogic.js'

describe('app manager logic', () => {
  it('parses job input text as a JSON object', () => {
    expect(parseJobInputText('')).toEqual({})
    expect(parseJobInputText('{ "path": "README.md" }')).toEqual({ path: 'README.md' })
  })

  it('rejects job input text that is not an object', () => {
    expect(() => parseJobInputText('[]')).toThrow('Job inputs must be a JSON object')
    expect(() => parseJobInputText('"text"')).toThrow('Job inputs must be a JSON object')
  })

  it('builds useful default JSON from required schema properties', () => {
    expect(defaultInputForSchema({
      required: ['path', 'limit', 'dryRun', 'tags', 'options'],
      properties: {
        path: { type: 'string' },
        limit: { type: 'integer' },
        dryRun: { type: 'boolean' },
        tags: { type: 'array' },
        options: { type: 'object' },
      },
    })).toBe(JSON.stringify({
      path: '',
      limit: 0,
      dryRun: false,
      tags: [],
      options: {},
    }, null, 2))
  })

  it('summarizes expected job inputs', () => {
    expect(jobInputSummary({ required: ['path'] })).toBe('Requires path')
    expect(jobInputSummary({ properties: { query: { type: 'string' } } })).toBe('Accepts query')
    expect(jobInputSummary()).toBe('No declared inputs')
  })

  it('labels app run timeline events with user-facing text', () => {
    expect(packageRunEventLabel({ type: 'job.step', data: { name: 'Reading files' } })).toBe('Reading files')
    expect(packageRunEventLabel({ type: 'job.progress', data: { label: 'Indexing', value: 0.42 } })).toBe('Indexing 42%')
    expect(packageRunEventLabel({ type: 'job.failed', data: { error: 'boom' } })).toBe('boom')
    expect(packageRunEventLabel({ type: 'job.started' })).toBe('started')
  })

  it('summarizes run progress and latest activity', () => {
    const run = {
      jobId: 'inspect',
      status: 'running',
      events: [
        { type: 'job.step', data: { name: 'Reading workspace' } },
        { type: 'job.progress', data: { label: 'Indexing', value: 1.4 } },
      ],
    }

    expect(latestRunProgress(run)).toEqual({ value: 1, percent: 100, label: 'Indexing 100%' })
    expect(latestRunActivity(run)).toBe('Indexing 100%')
    expect(latestRunProgress({ jobId: 'inspect', status: 'completed', events: [] })).toEqual({
      value: 1,
      percent: 100,
      label: 'Complete',
    })
  })

  it('formats run duration with stable elapsed text', () => {
    expect(runDurationLabel({
      jobId: 'inspect',
      status: 'completed',
      startedAt: '2026-05-28T00:00:00.000Z',
      completedAt: '2026-05-28T00:01:05.000Z',
    })).toBe('1m 5s')
  })

  it('finds an active single-concurrency run for a job', () => {
    const runs = [
      { jobId: 'inspect', status: 'completed' },
      { jobId: 'inspect', status: 'running' },
      { jobId: 'export', status: 'running' },
    ]

    expect(activeRunForJob({ id: 'inspect', concurrency: 'single' }, runs)?.status).toBe('running')
    expect(activeRunForJob({ id: 'inspect', concurrency: 'parallel' }, runs)).toBeNull()
  })
})
