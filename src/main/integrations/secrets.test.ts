import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}))

import keytar from 'keytar'
import { createMemorySecretStore, createKeytarSecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'

describe('createMemorySecretStore', () => {
  it('returns null for a missing secret', async () => {
    const store = createMemorySecretStore()
    expect(await store.get('Mim', 'slack')).toBeNull()
  })

  it('stores and retrieves a value by service + account', async () => {
    const store = createMemorySecretStore()
    await store.set('Mim', 'slack', 'xoxb-1')
    expect(await store.get('Mim', 'slack')).toBe('xoxb-1')
  })

  it('namespaces keys so same account under different services do not collide', async () => {
    const store = createMemorySecretStore()
    await store.set('ServiceA', 'account', 'a-value')
    await store.set('ServiceB', 'account', 'b-value')
    expect(await store.get('ServiceA', 'account')).toBe('a-value')
    expect(await store.get('ServiceB', 'account')).toBe('b-value')
  })

  it('overwrites an existing value on set', async () => {
    const store = createMemorySecretStore()
    await store.set('Mim', 'slack', 'old')
    await store.set('Mim', 'slack', 'new')
    expect(await store.get('Mim', 'slack')).toBe('new')
  })

  it('delete returns true when the secret existed and removes it', async () => {
    const store = createMemorySecretStore()
    await store.set('Mim', 'slack', 'xoxb-1')
    expect(await store.delete('Mim', 'slack')).toBe(true)
    expect(await store.get('Mim', 'slack')).toBeNull()
  })

  it('delete returns false when the secret did not exist', async () => {
    const store = createMemorySecretStore()
    expect(await store.delete('Mim', 'missing')).toBe(false)
  })

  it('seeds initial values keyed as service:account', async () => {
    const store = createMemorySecretStore({ 'Mim:slack': 'seeded' })
    expect(await store.get('Mim', 'slack')).toBe('seeded')
  })

  it('dump reflects the current state with service:account keys', async () => {
    const store = createMemorySecretStore({ 'Mim:google': 'g' })
    await store.set('Mim', 'slack', 's')
    await store.delete('Mim', 'google')
    expect(store.dump()).toEqual({ 'Mim:slack': 's' })
  })
})

describe('createKeytarSecretStore', () => {
  beforeEach(() => {
    vi.mocked(keytar.getPassword).mockReset()
    vi.mocked(keytar.setPassword).mockReset()
    vi.mocked(keytar.deletePassword).mockReset()
  })

  it('get delegates to keytar.getPassword and returns its result', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValue('secret-value')
    const store = createKeytarSecretStore()
    expect(await store.get(MIM_KEYCHAIN_SERVICE, 'slack')).toBe('secret-value')
    expect(keytar.getPassword).toHaveBeenCalledWith('Mim', 'slack')
  })

  it('get passes through null when the keychain has no entry', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValue(null)
    const store = createKeytarSecretStore()
    expect(await store.get('Mim', 'missing')).toBeNull()
  })

  it('set delegates to keytar.setPassword with service, account, value', async () => {
    vi.mocked(keytar.setPassword).mockResolvedValue(undefined)
    const store = createKeytarSecretStore()
    await store.set('Mim', 'google:work', '{"token":"t"}')
    expect(keytar.setPassword).toHaveBeenCalledWith('Mim', 'google:work', '{"token":"t"}')
  })

  it('delete delegates to keytar.deletePassword and returns its boolean', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValue(false)
    const store = createKeytarSecretStore()
    expect(await store.delete('Mim', 'slack')).toBe(false)
    expect(keytar.deletePassword).toHaveBeenCalledWith('Mim', 'slack')
  })

  it('wraps keytar errors with a keychain availability hint', async () => {
    vi.mocked(keytar.getPassword).mockRejectedValue(new Error('The user name or passphrase you entered is not correct'))
    const store = createKeytarSecretStore()
    await expect(store.get('Mim', 'slack')).rejects.toThrow('OS keychain unavailable')
    await expect(store.get('Mim', 'slack')).rejects.toThrow('passphrase')
  })
})
