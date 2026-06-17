import { describe, expect, it } from 'vitest'
import { permissionLines } from './permissionSummary.js'

describe('permissionLines', () => {
  it('renders a full permission set in plain language', () => {
    expect(permissionLines({
      workspace: { read: true, write: true },
      ai: true,
      http: ['api.github.com', '*.github.com'],
      secrets: ['github_token'],
    })).toEqual([
      'Read and edit files in this workspace',
      'Use AI from its backend',
      'Connect to api.github.com, *.github.com',
      'Use your github_token secret from the system keychain',
    ])
  })

  it('renders read-only workspace access without the edit clause', () => {
    expect(permissionLines({ workspace: { read: true } })).toEqual([
      'Read files in this workspace',
    ])
  })

  it('pluralizes multiple secrets', () => {
    expect(permissionLines({ secrets: ['a_token', 'b_token'] })).toEqual([
      'Use your a_token, b_token secrets from the system keychain',
    ])
  })

  it('falls back to "No special access" for an empty declaration', () => {
    expect(permissionLines({})).toEqual(['No special access'])
    expect(permissionLines({ workspace: { read: false }, http: [], secrets: [] })).toEqual(['No special access'])
  })
})
