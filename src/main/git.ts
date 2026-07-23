import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'

const execFileAsync = promisify(execFile)

/** scp-style (`git@host:path`) or `ssh://` URLs — auth via SSH keys, system git only. */
export function isSshUrl(url: string): boolean {
  return /^(ssh:\/\/|[^/@]+@[^/]+:)/.test(url)
}

/** Inject a token as the URL username for system-git HTTPS clones. Unparseable URLs pass through. */
export function buildAuthedUrl(url: string, token?: string): string {
  if (!token) return url
  try {
    const parsed = new URL(url)
    parsed.username = token
    return parsed.toString()
  } catch {
    return url
  }
}

/** True if a `git` binary is on PATH. */
export async function hasSystemGit(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export function gitInstallAction(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'Run xcode-select --install, then try again.'
  if (platform === 'win32') return 'Run winget install --id Git.Git -e, then try again.'
  return 'Run sudo apt install git, then try again.'
}

export async function hasSystemGitLfs(): Promise<boolean> {
  try {
    await execFileAsync('git', ['lfs', 'version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export function gitLfsInstallAction(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'Run brew install git-lfs && git lfs install, then try again.'
  if (platform === 'win32') return 'Run winget install --id GitHub.GitLFS -e, then git lfs install and try again.'
  return 'Run sudo apt install git-lfs && git lfs install, then try again.'
}

function cloneWithSystemGit(
  url: string,
  target: string,
  token?: string,
): Promise<{ cloned: string }> {
  return new Promise((resolve, reject) => {
    const cloneUrl = buildAuthedUrl(url, token)
    execFile('git', ['clone', cloneUrl, target], { timeout: 120000 }, (error, _stdout, stderr) => {
      if (error) {
        // Strip the token from any surfaced error text.
        const safeMsg = (stderr || error.message).replace(new RegExp(token ?? '__NONE__', 'g'), '***')
        reject(new Error(safeMsg))
      } else {
        resolve({ cloned: target })
      }
    })
  })
}

async function cloneWithIsomorphicGit(
  url: string,
  target: string,
  token?: string,
): Promise<{ cloned: string }> {
  await git.clone({
    fs,
    http,
    dir: target,
    url,
    onAuth: token ? () => ({ username: token }) : undefined,
  })
  return { cloned: target }
}

/**
 * Clone a repository, preferring the system `git` binary (full features, SSH, user
 * credentials) and falling back to the bundled isomorphic-git (pure JS, HTTPS only)
 * when no git is installed. See docs/git.md.
 */
export async function cloneRepo(
  url: string,
  target: string,
  token?: string,
): Promise<{ cloned: string }> {
  if (await hasSystemGit()) {
    return cloneWithSystemGit(url, target, token)
  }
  if (isSshUrl(url)) {
    throw new Error(
      'SSH URLs require git to be installed. Install git, or use the HTTPS URL (with a token for private repos).',
    )
  }
  return cloneWithIsomorphicGit(url, target, token)
}

/**
 * Fast-forward an existing pull-only clone from its origin. Registry mirrors
 * are never written to, so --ff-only applies. Falls back to isomorphic-git
 * without system git.
 */
export async function pullRepo(dir: string): Promise<{ pulled: string }> {
  if (await hasSystemGit()) {
    await execFileAsync('git', ['-C', dir, 'pull', '--ff-only'], { timeout: 120000 })
    return { pulled: dir }
  }
  await git.fastForward({ fs, http, dir, singleBranch: true })
  return { pulled: dir }
}

/**
 * Fetch all refs and tags into an existing mirror without touching its
 * checkout state. Package mirrors get checked out to tags (detached HEAD),
 * where `pull --ff-only` fails — installs must fetch + checkout instead.
 */
export async function fetchRepo(dir: string): Promise<void> {
  if (await hasSystemGit()) {
    await execFileAsync('git', ['-C', dir, 'fetch', '--tags', '--force', 'origin'], { timeout: 120000 })
    return
  }
  await git.fetch({ fs, http, dir, tags: true })
}

/** Move a mirror to the remote default branch tip (detached). */
export async function checkoutRemoteDefault(dir: string): Promise<void> {
  if (await hasSystemGit()) {
    await execFileAsync('git', ['-C', dir, 'checkout', '--detach', 'origin/HEAD'], { timeout: 30000 })
    return
  }
  const ref = await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/HEAD' }).catch(() => null)
  if (ref) await git.checkout({ fs, dir, ref, force: true })
}

export async function checkoutRef(dir: string, ref: string): Promise<void> {
  if (await hasSystemGit()) {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', dir, 'checkout', ref], { timeout: 30000 }, (error, _stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message))
        else resolve()
      })
    })
  }
  await git.checkout({ fs, dir, ref, force: true })
}

export async function resolveHead(dir: string): Promise<string> {
  if (await hasSystemGit()) {
    return new Promise((resolve, reject) => {
      execFile('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 10000 }, (error, stdout) => {
        if (error) reject(new Error(error.message))
        else resolve(stdout.trim())
      })
    })
  }
  return git.resolveRef({ fs, dir, ref: 'HEAD' })
}
