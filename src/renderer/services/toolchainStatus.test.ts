// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToolchainStatus, resetToolchainCache, type ToolchainStatusResult } from './toolchainStatus.js'

describe('toolchainStatus', () => {
  let kernelCall: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetToolchainCache()
    kernelCall = vi.fn(async () => ({
      entries: [
        { id: 'rscript', name: 'Rscript', bin: 'Rscript', installed: true, binPath: '/usr/bin/Rscript', version: '4.4.1' },
        { id: 'quarto', name: 'Quarto', bin: 'quarto', installed: true, binPath: '/usr/local/bin/quarto', version: '1.5.57' },
        { id: 'r', name: 'R', bin: 'R', installed: true, binPath: '/usr/bin/R', version: '4.4.1' },
        { id: 'pandoc', name: 'pandoc', bin: 'pandoc', installed: false },
        { id: 'python3', name: 'Python', bin: 'python3', installed: false },
      ],
    }))
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call: kernelCall },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls toolchain.status and returns the entries', async () => {
    const result = await getToolchainStatus()
    expect(kernelCall).toHaveBeenCalledWith('toolchain.status', {})
    expect(result.entries.length).toBe(5)
    expect(result.entries[0].id).toBe('rscript')
  })

  it('caches the result — second call does not invoke kernel again', async () => {
    const first = await getToolchainStatus()
    const second = await getToolchainStatus()
    expect(kernelCall).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('resetToolchainCache clears the cache so next call fetches fresh', async () => {
    await getToolchainStatus()
    resetToolchainCache()
    await getToolchainStatus()
    expect(kernelCall).toHaveBeenCalledTimes(2)
  })

  it('returns empty entries when kernel call fails', async () => {
    kernelCall.mockRejectedValue(new Error('no workspace'))
    const result = await getToolchainStatus()
    expect(result.entries).toEqual([])
  })

  it('returns empty entries when response has no entries array', async () => {
    kernelCall.mockResolvedValue({})
    const result = await getToolchainStatus()
    expect(result.entries).toEqual([])
  })

  it('provides hasQuarto and hasRscript convenience booleans', async () => {
    const result = await getToolchainStatus()
    expect(result.hasQuarto).toBe(true)
    expect(result.hasRscript).toBe(true)
  })

  it('hasQuarto is false when quarto not installed', async () => {
    kernelCall.mockResolvedValue({
      entries: [
        { id: 'quarto', name: 'Quarto', bin: 'quarto', installed: false },
        { id: 'rscript', name: 'Rscript', bin: 'Rscript', installed: true },
      ],
    })
    const result = await getToolchainStatus()
    expect(result.hasQuarto).toBe(false)
    expect(result.hasRscript).toBe(true)
  })

  it('canRender is true when at least one engine is available', async () => {
    const result = await getToolchainStatus()
    expect(result.canRender).toBe(true)
  })

  it('canRender is false when neither quarto nor rscript is installed', async () => {
    kernelCall.mockResolvedValue({
      entries: [
        { id: 'quarto', name: 'Quarto', bin: 'quarto', installed: false },
        { id: 'rscript', name: 'Rscript', bin: 'Rscript', installed: false },
      ],
    })
    const result = await getToolchainStatus()
    expect(result.canRender).toBe(false)
  })
})
