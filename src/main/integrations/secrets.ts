import keytar from 'keytar'

export interface SecretStore {
  get(service: string, account: string): Promise<string | null>
  set(service: string, account: string, value: string): Promise<void>
  delete(service: string, account: string): Promise<boolean>
}

export const MIM_KEYCHAIN_SERVICE = 'Mim'

export function createKeytarSecretStore(): SecretStore {
  return {
    get: (service, account) => withKeychainError(() => keytar.getPassword(service, account)),
    set: (service, account, value) => withKeychainError(() => keytar.setPassword(service, account, value)),
    delete: (service, account) => withKeychainError(() => keytar.deletePassword(service, account)),
  }
}

async function withKeychainError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`OS keychain unavailable: ${detail}`)
  }
}

export function createMemorySecretStore(initial: Record<string, string> = {}): SecretStore & { dump(): Record<string, string> } {
  const values = new Map(Object.entries(initial))
  const key = (service: string, account: string) => `${service}:${account}`
  return {
    async get(service, account) {
      return values.get(key(service, account)) ?? null
    },
    async set(service, account, value) {
      values.set(key(service, account), value)
    },
    async delete(service, account) {
      return values.delete(key(service, account))
    },
    dump() {
      return Object.fromEntries(values)
    },
  }
}
