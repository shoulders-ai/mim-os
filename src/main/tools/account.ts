// Account token management — follows the ai.setKey / ai.clearKey pattern for
// ~/.mim/keys.env but manages MIM_ACCOUNT_TOKEN for private registry auth.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { userHomeDir } from '@main/platform.js'

export const MIM_ACCOUNT_TOKEN_KEY = 'MIM_ACCOUNT_TOKEN'

const DEV_URL = 'http://localhost:3000/api/v1/registry'
const PROD_URL = 'https://mim.shoulde.rs/api/v1/registry'

let _isDev = false
export function setAccountDev(dev: boolean): void { _isDev = dev }

export function accountBaseUrl(): string {
  if (process.env.MIM_ACCOUNT_REGISTRY_URL) {
    return process.env.MIM_ACCOUNT_REGISTRY_URL.replace(/\/index$/, '')
  }
  return _isDev ? DEV_URL : PROD_URL
}

export function accountValidateUrl(): string {
  return `${accountBaseUrl()}/validate`
}

/**
 * Read the account token from ~/.mim/keys.env. Returns null if absent.
 * Exported so registrySources can inject `getAccountToken`.
 */
export function readAccountToken(home?: string): string | null {
  const keysPath = join(home ?? userHomeDir(), '.mim', 'keys.env')
  if (!existsSync(keysPath)) return null

  const content = readFileSync(keysPath, 'utf-8')
  for (const line of content.split(/\r\n|\n|\r/)) {
    const [k, ...rest] = line.split('=')
    if (k?.trim() === MIM_ACCOUNT_TOKEN_KEY && rest.length) {
      return rest.join('=').trim().replace(/^["']|["']$/g, '')
    }
  }
  return null
}

export function registerAccountTools(
  tools: ToolRegistry,
  emit: (channel: string) => void,
  opts?: { home?: string; fetchUrl?: (url: string, init?: RequestInit) => Promise<Response> },
): void {
  const home = opts?.home
  const doFetch = opts?.fetchUrl ?? globalThis.fetch

  tools.register({
    name: 'account.setToken',
    description: 'Save an account token to ~/.mim/keys.env',
    execute: async (params) => {
      const token = params.token as string
      if (!token || typeof token !== 'string') throw new Error('Missing required parameter: token')

      const dir = join(home ?? userHomeDir(), '.mim')
      const keysPath = join(dir, 'keys.env')

      mkdirSync(dir, { recursive: true })

      let content = ''
      if (existsSync(keysPath)) {
        content = readFileSync(keysPath, 'utf-8')
        const lines = content.split(/\r\n|\n|\r/)
        const filtered = lines.filter(l => !l.startsWith(`${MIM_ACCOUNT_TOKEN_KEY}=`))
        content = filtered.join('\n')
      }

      content = content.trimEnd() + `\n${MIM_ACCOUNT_TOKEN_KEY}=${token}\n`
      writeFileSync(keysPath, content, { mode: 0o600 })
      // writeFileSync's mode only applies on creation; fix pre-existing files.
      chmodSync(keysPath, 0o600)
      emit('account:changed')
      return { saved: true }
    },
  })

  tools.register({
    name: 'account.clearToken',
    description: 'Remove the account token from ~/.mim/keys.env',
    execute: async () => {
      const keysPath = join(home ?? userHomeDir(), '.mim', 'keys.env')
      if (existsSync(keysPath)) {
        const remaining = readFileSync(keysPath, 'utf-8')
          .split(/\r\n|\n|\r/)
          .filter(line => !line.startsWith(`${MIM_ACCOUNT_TOKEN_KEY}=`))
        writeFileSync(keysPath, remaining.join('\n'), { mode: 0o600 })
        chmodSync(keysPath, 0o600)
      }
      emit('account:changed')
      return { cleared: true }
    },
  })

  tools.register({
    name: 'account.status',
    description: 'Check whether an account token is configured',
    execute: async () => {
      const token = readAccountToken(home)
      return { connected: !!token }
    },
  })

  tools.register({
    name: 'account.validate',
    description: 'Validate the stored account token against the server',
    execute: async () => {
      const token = readAccountToken(home)
      if (!token) throw new Error('No account token configured')

      const res = await doFetch(accountValidateUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Account validation failed (${res.status}): ${body}`)
      }

      return await res.json()
    },
  })
}
