import { describe, expect, it } from 'vitest'
import { createMemorySecretStore } from '@main/integrations/secrets.js'
import { createPackageSecretsApi, packageSecretAccount } from '@main/packages/packageSecrets.js'

describe('app secrets', () => {
  it('namespaces keychain accounts by app id and secret name', () => {
    expect(packageSecretAccount('github-monitor', 'github_token')).toBe('package:github-monitor:github_token')
  })

  it('round-trips declared secrets through the store', async () => {
    const store = createMemorySecretStore()
    const secrets = createPackageSecretsApi({ packageId: 'github-monitor', declared: ['github_token'], store })

    expect(await secrets.has('github_token')).toBe(false)
    expect(await secrets.get('github_token')).toBeNull()

    await secrets.set('github_token', 'ghp_abc123')
    expect(await secrets.has('github_token')).toBe(true)
    expect(await secrets.get('github_token')).toBe('ghp_abc123')

    expect(await secrets.delete('github_token')).toBe(true)
    expect(await secrets.get('github_token')).toBeNull()
  })

  it('rejects secret names the manifest did not declare', async () => {
    const store = createMemorySecretStore()
    const secrets = createPackageSecretsApi({ packageId: 'github-monitor', declared: ['github_token'], store })

    await expect(secrets.get('other_token')).rejects.toThrow('Package github-monitor did not declare secret: other_token')
    await expect(secrets.set('other_token', 'x')).rejects.toThrow('did not declare secret')
    await expect(secrets.delete('other_token')).rejects.toThrow('did not declare secret')
    await expect(secrets.has('other_token')).rejects.toThrow('did not declare secret')
  })

  it('rejects every access when the manifest declares no secrets', async () => {
    const store = createMemorySecretStore()
    const secrets = createPackageSecretsApi({ packageId: 'github-monitor', declared: undefined, store })

    await expect(secrets.get('github_token')).rejects.toThrow('did not declare secret')
  })

  it('isolates secrets between packages even for the same name', async () => {
    const store = createMemorySecretStore()
    const first = createPackageSecretsApi({ packageId: 'pkg-a', declared: ['token'], store })
    const second = createPackageSecretsApi({ packageId: 'pkg-b', declared: ['token'], store })

    await first.set('token', 'a-value')
    await second.set('token', 'b-value')

    expect(await first.get('token')).toBe('a-value')
    expect(await second.get('token')).toBe('b-value')
  })
})
