import { MIM_KEYCHAIN_SERVICE, type SecretStore } from '@main/integrations/secrets.js'

// Package-scoped keychain access. Secrets live in the OS keychain under the
// shared Mim service with a `package:{packageId}:{name}` account, so packages
// can never read each other's secrets and values never touch workspace files.
// Only names declared in the manifest `permissions.secrets` list are reachable.
export interface PackageSecretsApi {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<boolean>
  has(name: string): Promise<boolean>
}

export function packageSecretAccount(packageId: string, name: string): string {
  return `package:${packageId}:${name}`
}

export function createPackageSecretsApi(options: {
  packageId: string
  declared: string[] | undefined
  store: SecretStore
}): PackageSecretsApi {
  const { packageId, store } = options
  const declared = new Set(options.declared ?? [])

  function account(name: string): string {
    if (!declared.has(name)) throw new Error(`Package ${packageId} did not declare secret: ${name}`)
    return packageSecretAccount(packageId, name)
  }

  return {
    async get(name) {
      return store.get(MIM_KEYCHAIN_SERVICE, account(name))
    },
    async set(name, value) {
      await store.set(MIM_KEYCHAIN_SERVICE, account(name), value)
    },
    async delete(name) {
      return store.delete(MIM_KEYCHAIN_SERVICE, account(name))
    },
    async has(name) {
      return (await store.get(MIM_KEYCHAIN_SERVICE, account(name))) != null
    },
  }
}
