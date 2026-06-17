import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { electronBuilderOsName } from '@main/platform.js'
import { resolveDocxWorkerPath, runDocxWorker } from '@main/docx/worker.js'

describe('runDocxWorker', () => {
  const originalWorkerPath = process.env.DOCX_WORKER_PATH
  const originalCwd = process.cwd()
  const tempDirs: string[] = []

  afterEach(() => {
    if (originalWorkerPath === undefined) delete process.env.DOCX_WORKER_PATH
    else process.env.DOCX_WORKER_PATH = originalWorkerPath

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    process.chdir(originalCwd)
  })

  function fakeWorker(source: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'mim-docx-worker-test-'))
    tempDirs.push(dir)
    const workerPath = join(dir, 'docx-worker')
    writeFileSync(workerPath, source, 'utf-8')
    chmodSync(workerPath, 0o755)
    process.env.DOCX_WORKER_PATH = workerPath
    return workerPath
  }

  it('returns structured worker JSON even when the worker exits non-zero', async () => {
    fakeWorker(`#!/usr/bin/env node
console.log(JSON.stringify({
  success: false,
  outputPath: 'reviewed.docx',
  results: [{ index: 0, success: false, error: 'Text not found in document' }],
  summary: { total: 1, succeeded: 0, failed: 1 }
}))
process.exit(1)
`)

    await expect(runDocxWorker({
      command: 'annotate',
      inputPath: 'source.docx',
      outputPath: 'reviewed.docx',
      operations: [],
    })).resolves.toMatchObject({
      success: false,
      outputPath: 'reviewed.docx',
      summary: { total: 1, succeeded: 0, failed: 1 },
    })
  })

  it('still throws non-json worker failures', async () => {
    fakeWorker(`#!/usr/bin/env node
console.error('worker crashed before JSON output')
process.exit(1)
`)

    await expect(runDocxWorker({
      command: 'validate',
      path: 'source.docx',
    })).rejects.toThrow('worker crashed before JSON output')
  })

  it('resolves the electron-builder OS resource layout', () => {
    if (originalWorkerPath === undefined) delete process.env.DOCX_WORKER_PATH
    else process.env.DOCX_WORKER_PATH = ''

    const root = mkdtempSync(join(tmpdir(), 'mim-docx-worker-root-'))
    tempDirs.push(root)
    const dir = join(root, 'resources', 'docx-worker', `${electronBuilderOsName()}-${process.arch}`)
    mkdirSync(dir, { recursive: true })
    const executable = join(dir, process.platform === 'win32' ? 'docx-worker.exe' : 'docx-worker')
    writeFileSync(executable, 'x')
    process.chdir(root)

    expect(resolveDocxWorkerPath()).toBe(realpathSync(executable))
  })
})
