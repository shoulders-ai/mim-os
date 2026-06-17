import { describe, expect, it } from 'vitest'
import { classifyPermissionPath } from '@main/security/gate-paths.js'

describe('permission path classification', () => {
  const workspacePath = '/Users/test/workspace'

  it('allows ordinary relative workspace paths', () => {
    expect(classifyPermissionPath('docs/notes.md', workspacePath)).toMatchObject({
      kind: 'workspace',
      absolutePath: '/Users/test/workspace/docs/notes.md',
    })
  })

  it('allows the workspace root itself', () => {
    expect(classifyPermissionPath('.', workspacePath)).toMatchObject({
      kind: 'workspace',
      absolutePath: workspacePath,
    })
  })

  it('flags secret-like paths inside the workspace', () => {
    expect(classifyPermissionPath('.env', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Path contains sensitive segment: .env',
    })
    expect(classifyPermissionPath('config/secrets/token.txt', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Path contains sensitive segment: secrets',
    })
    expect(classifyPermissionPath('deploy/credentials/aws.json', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Path contains sensitive segment: credentials',
    })
  })

  it('flags common private system and account paths as sensitive instead of hard-rejecting them', () => {
    expect(classifyPermissionPath('/Users/test/.ssh/id_rsa', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Sensitive location: .ssh',
    })
    expect(classifyPermissionPath('/Users/test/.aws/credentials', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Sensitive location: .aws',
    })
    expect(classifyPermissionPath('/etc/hosts', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Sensitive location: /etc',
    })
  })

  it('classifies non-sensitive absolute paths outside the workspace separately', () => {
    expect(classifyPermissionPath('/Users/test/Downloads/input.csv', workspacePath)).toMatchObject({
      kind: 'outside-workspace',
      absolutePath: '/Users/test/Downloads/input.csv',
    })
  })

  it('handles missing paths and missing workspaces explicitly', () => {
    expect(classifyPermissionPath('', workspacePath)).toMatchObject({
      kind: 'invalid',
      reason: 'No path provided',
    })
    expect(classifyPermissionPath('/Users/test/file.txt', null)).toMatchObject({
      kind: 'outside-workspace',
      reason: 'No workspace is open',
    })
  })
})

describe('permission path classification — resource mounts', () => {
  const workspacePath = '/Users/test/workspace'

  it('classifies files under .mim/resources/<id> as resource paths', () => {
    expect(classifyPermissionPath('.mim/resources/templates/proposal.md', workspacePath)).toMatchObject({
      kind: 'resource',
      resourceCollectionId: 'templates',
      isResourceRoot: false,
      absolutePath: '/Users/test/workspace/.mim/resources/templates/proposal.md',
    })
  })

  it('classifies nested resource files with the right collection id', () => {
    expect(classifyPermissionPath('/Users/test/workspace/.mim/resources/journal-guidance/a/b/c.md', workspacePath)).toMatchObject({
      kind: 'resource',
      resourceCollectionId: 'journal-guidance',
    })
  })

  it('marks the mount symlink itself as a resource root', () => {
    expect(classifyPermissionPath('.mim/resources/templates', workspacePath)).toMatchObject({
      kind: 'resource',
      resourceCollectionId: 'templates',
      isResourceRoot: true,
    })
  })

  it('marks the mounts dir itself as a resource root without a collection', () => {
    expect(classifyPermissionPath('.mim/resources', workspacePath)).toMatchObject({
      kind: 'resource',
      isResourceRoot: true,
    })
    expect(classifyPermissionPath('.mim/resources', workspacePath).resourceCollectionId).toBeUndefined()
  })

  it('leaves other .mim paths as plain workspace paths', () => {
    expect(classifyPermissionPath('.mim/settings.json', workspacePath)).toMatchObject({ kind: 'workspace' })
    expect(classifyPermissionPath('.mim/resources.json', workspacePath)).toMatchObject({ kind: 'workspace' })
  })

  it('classifies the package enablement/trust ledger as sensitive', () => {
    expect(classifyPermissionPath('.mim/packages/enabled.json', workspacePath)).toMatchObject({
      kind: 'sensitive',
      reason: 'Package enablement ledger',
    })
    expect(classifyPermissionPath('/Users/test/workspace/.mim/packages/enabled.json', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
  })

  it('resolves dot-dot segments before classifying', () => {
    expect(classifyPermissionPath('.mim/resources/templates/../../settings.json', workspacePath)).toMatchObject({
      kind: 'workspace',
    })
  })

  it('keeps sensitive-segment precedence inside mounts', () => {
    expect(classifyPermissionPath('.mim/resources/templates/credentials/aws.json', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
  })
})

describe('extended sensitive path patterns (Fix 3)', () => {
  const workspacePath = '/Users/test/workspace'

  it('matches .env.production and .env.local as sensitive (prefix match)', () => {
    expect(classifyPermissionPath('.env.production', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('.env.local', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('.env.development', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('config/.env.staging', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
  })

  it('does not match envelope.md or environment.ts as sensitive', () => {
    expect(classifyPermissionPath('envelope.md', workspacePath)).toMatchObject({
      kind: 'workspace',
    })
    expect(classifyPermissionPath('src/environment.ts', workspacePath)).toMatchObject({
      kind: 'workspace',
    })
    expect(classifyPermissionPath('envoy.conf', workspacePath)).toMatchObject({
      kind: 'workspace',
    })
  })

  it('matches .netrc as sensitive', () => {
    expect(classifyPermissionPath('/Users/test/.netrc', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('.netrc', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
  })

  it('matches shell config files as sensitive', () => {
    expect(classifyPermissionPath('/Users/test/.bashrc', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('/Users/test/.zshrc', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('/Users/test/.profile', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('/Users/test/.bash_profile', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('/Users/test/.bash_history', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('/Users/test/.zsh_history', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
  })

  it('matches SSH key file names as sensitive even outside .ssh', () => {
    expect(classifyPermissionPath('backup/id_rsa', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('backup/id_ed25519', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('backup/id_rsa.pub', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('backup/id_ed25519.pub', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
    expect(classifyPermissionPath('backup/id_ecdsa', workspacePath)).toMatchObject({
      kind: 'sensitive',
    })
  })
})
