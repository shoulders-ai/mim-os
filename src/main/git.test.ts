import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the two system boundaries: the git binary (child_process) and isomorphic-git.
const { execFileMock, cloneMock, checkoutMock, resolveRefMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  cloneMock: vi.fn(),
  checkoutMock: vi.fn(),
  resolveRefMock: vi.fn(),
}))
vi.mock('child_process', () => ({ execFile: execFileMock }))
vi.mock('isomorphic-git', () => ({
  default: { clone: cloneMock, checkout: checkoutMock, resolveRef: resolveRefMock },
}))
vi.mock('isomorphic-git/http/node', () => ({ default: {} }))

import { cloneRepo, isSshUrl, buildAuthedUrl, checkoutRef, resolveHead } from '@main/git.js'

/**
 * Drive the mocked `git` binary: `git --version` resolves only when `available`,
 * and `git clone` resolves unless a clone error/stderr is supplied.
 */
function setSystemGit(
  available: boolean,
  clone: { error?: string; stderr?: string } = {},
  opts?: {
    checkout?: { error?: string; stderr?: string }
    revParse?: { stdout?: string; error?: string }
  },
): void {
  execFileMock.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
    if (args[0] === '--version') {
      available ? cb(null, 'git version 2.40.0', '') : cb(new Error('git: command not found'))
      return
    }
    if (args[0] === 'clone') {
      clone.error ? cb(new Error(clone.error), '', clone.stderr ?? '') : cb(null, '', '')
      return
    }
    if (args[0] === '-C' && args[2] === 'checkout') {
      const co = opts?.checkout ?? {}
      co.error ? cb(new Error(co.error), '', co.stderr ?? '') : cb(null, '', '')
      return
    }
    if (args[0] === '-C' && args[2] === 'rev-parse') {
      const rp = opts?.revParse ?? {}
      rp.error
        ? cb(new Error(rp.error), '', '')
        : cb(null, rp.stdout ?? 'abc123\n', '')
      return
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  cloneMock.mockResolvedValue(undefined)
  checkoutMock.mockResolvedValue(undefined)
  resolveRefMock.mockResolvedValue('abc123')
})

describe('isSshUrl', () => {
  it('detects scp-style SSH URLs', () => {
    expect(isSshUrl('git@github.com:org/repo.git')).toBe(true)
  })

  it('detects ssh:// URLs', () => {
    expect(isSshUrl('ssh://git@github.com/org/repo.git')).toBe(true)
  })

  it('treats HTTPS URLs as non-SSH', () => {
    expect(isSshUrl('https://github.com/org/repo.git')).toBe(false)
  })

  it('treats http URLs as non-SSH', () => {
    expect(isSshUrl('http://example.com/org/repo.git')).toBe(false)
  })
})

describe('buildAuthedUrl', () => {
  it('injects a token as the username for HTTPS URLs', () => {
    expect(buildAuthedUrl('https://github.com/org/repo.git', 'tok123')).toBe(
      'https://tok123@github.com/org/repo.git',
    )
  })

  it('returns the URL unchanged when no token is given', () => {
    expect(buildAuthedUrl('https://github.com/org/repo.git')).toBe(
      'https://github.com/org/repo.git',
    )
  })

  it('returns the URL unchanged when it cannot be parsed', () => {
    expect(buildAuthedUrl('git@github.com:org/repo.git', 'tok123')).toBe(
      'git@github.com:org/repo.git',
    )
  })
})

describe('cloneRepo backend selection', () => {
  it('uses system git when available and does not touch isomorphic-git', async () => {
    setSystemGit(true)
    const result = await cloneRepo('https://github.com/org/repo.git', '/tmp/repo')
    expect(result).toEqual({ cloned: '/tmp/repo' })
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/org/repo.git', '/tmp/repo'],
      expect.anything(),
      expect.any(Function),
    )
    expect(cloneMock).not.toHaveBeenCalled()
  })

  it('passes a token to system git as an authed URL', async () => {
    setSystemGit(true)
    await cloneRepo('https://github.com/org/repo.git', '/tmp/repo', 'tok')
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://tok@github.com/org/repo.git', '/tmp/repo'],
      expect.anything(),
      expect.any(Function),
    )
  })

  it('strips the token from system git error messages', async () => {
    setSystemGit(true, { error: 'fatal', stderr: 'remote: tok rejected' })
    await expect(cloneRepo('https://github.com/org/repo.git', '/tmp/repo', 'tok')).rejects.toThrow(
      'remote: *** rejected',
    )
  })

  it('falls back to isomorphic-git for HTTPS when no system git', async () => {
    setSystemGit(false)
    const result = await cloneRepo('https://github.com/org/repo.git', '/tmp/repo', 'tok')
    expect(result).toEqual({ cloned: '/tmp/repo' })
    expect(cloneMock).toHaveBeenCalledTimes(1)
    const arg = cloneMock.mock.calls[0][0]
    expect(arg.url).toBe('https://github.com/org/repo.git')
    expect(arg.dir).toBe('/tmp/repo')
    expect(arg.onAuth()).toEqual({ username: 'tok' })
  })

  it('omits onAuth for the fallback when no token is given', async () => {
    setSystemGit(false)
    await cloneRepo('https://github.com/org/repo.git', '/tmp/repo')
    expect(cloneMock.mock.calls[0][0].onAuth).toBeUndefined()
  })

  it('throws a friendly error for SSH URLs when no system git, without cloning', async () => {
    setSystemGit(false)
    await expect(cloneRepo('git@github.com:org/repo.git', '/tmp/repo')).rejects.toThrow(
      /SSH URLs require git/,
    )
    expect(cloneMock).not.toHaveBeenCalled()
  })
})

describe('checkoutRef', () => {
  it('uses system git -C <dir> checkout <ref> when available', async () => {
    setSystemGit(true)
    await checkoutRef('/tmp/repo', 'v1.2.0')
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['-C', '/tmp/repo', 'checkout', 'v1.2.0'],
      expect.anything(),
      expect.any(Function),
    )
    expect(checkoutMock).not.toHaveBeenCalled()
  })

  it('falls back to isomorphic-git checkout when no system git', async () => {
    setSystemGit(false)
    await checkoutRef('/tmp/repo', 'v1.2.0')
    expect(checkoutMock).toHaveBeenCalledTimes(1)
    const arg = checkoutMock.mock.calls[0][0]
    expect(arg.dir).toBe('/tmp/repo')
    expect(arg.ref).toBe('v1.2.0')
    expect(arg.force).toBe(true)
  })

  it('propagates system git errors', async () => {
    setSystemGit(true, {}, { checkout: { error: 'pathspec not found' } })
    await expect(checkoutRef('/tmp/repo', 'v999')).rejects.toThrow('pathspec not found')
  })

  it('propagates isomorphic-git errors when no system git', async () => {
    setSystemGit(false)
    checkoutMock.mockRejectedValue(new Error('Could not find ref'))
    await expect(checkoutRef('/tmp/repo', 'v999')).rejects.toThrow('Could not find ref')
  })
})

describe('resolveHead', () => {
  it('uses system git rev-parse HEAD when available', async () => {
    setSystemGit(true, {}, { revParse: { stdout: 'deadbeef1234567890abcdef\n' } })
    const sha = await resolveHead('/tmp/repo')
    expect(sha).toBe('deadbeef1234567890abcdef')
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['-C', '/tmp/repo', 'rev-parse', 'HEAD'],
      expect.anything(),
      expect.any(Function),
    )
    expect(resolveRefMock).not.toHaveBeenCalled()
  })

  it('falls back to isomorphic-git resolveRef when no system git', async () => {
    setSystemGit(false)
    resolveRefMock.mockResolvedValue('cafebabe0123')
    const sha = await resolveHead('/tmp/repo')
    expect(sha).toBe('cafebabe0123')
    expect(resolveRefMock).toHaveBeenCalledWith(
      expect.objectContaining({ dir: '/tmp/repo', ref: 'HEAD' }),
    )
  })

  it('strips trailing whitespace from system git output', async () => {
    setSystemGit(true, {}, { revParse: { stdout: '  abc123  \n' } })
    const sha = await resolveHead('/tmp/repo')
    expect(sha).toBe('abc123')
  })

  it('propagates system git errors', async () => {
    setSystemGit(true, {}, { revParse: { error: 'not a git repo' } })
    await expect(resolveHead('/tmp/repo')).rejects.toThrow('not a git repo')
  })

  it('propagates isomorphic-git errors when no system git', async () => {
    setSystemGit(false)
    resolveRefMock.mockRejectedValue(new Error('Could not find HEAD'))
    await expect(resolveHead('/tmp/repo')).rejects.toThrow('Could not find HEAD')
  })
})
