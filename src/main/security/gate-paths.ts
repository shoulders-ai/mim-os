import { isAbsolute, relative, resolve, sep } from 'path'

export type PermissionPathKind = 'workspace' | 'resource' | 'sensitive' | 'outside-workspace' | 'invalid'

export interface PermissionPathClassification {
  kind: PermissionPathKind
  reason: string
  absolutePath: string | null
  // Set for kind 'resource': the collection id under .mim/resources/, and
  // whether the path IS a mount root (the mounts dir or a mount symlink itself)
  // rather than a file inside one. See docs/resources.md.
  resourceCollectionId?: string
  isResourceRoot?: boolean
}

const SENSITIVE_LOCATIONS = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.config/gcloud',
  '.kube',
  '.docker',
  '.npmrc',
  '.pypirc',
  '/etc',
  '/private/etc',
  '/var/run',
  '/Library/Keychains',
]

const SENSITIVE_SEGMENTS = ['credentials', 'secrets']

// Segments that match by exact name (case-insensitive via lowercased segments).
const SENSITIVE_EXACT_SEGMENTS = [
  '.netrc',
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  '.bash_history',
  '.zsh_history',
]

// Segments that match by prefix: a path segment starting with this prefix is
// sensitive. E.g. `.env` matches `.env`, `.env.production`, `.env.local`.
const SENSITIVE_PREFIX_SEGMENTS = ['.env']

// SSH key filename patterns — match exact segment names that look like private
// keys or their public counterparts, even outside ~/.ssh.
const SENSITIVE_KEY_PATTERN = /^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/

export function classifyPermissionPath(
  requestedPath: string | null | undefined,
  workspacePath: string | null,
): PermissionPathClassification {
  if (!requestedPath || requestedPath.trim().length === 0) {
    return { kind: 'invalid', reason: 'No path provided', absolutePath: null }
  }

  const base = workspacePath ? resolve(workspacePath) : null
  const absolutePath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(base ?? '/', requestedPath)

  const sensitiveLocation = findSensitiveLocation(absolutePath)
  if (sensitiveLocation) {
    return {
      kind: 'sensitive',
      reason: `Sensitive location: ${sensitiveLocation}`,
      absolutePath,
    }
  }

  const sensitiveSegment = findSensitiveSegment(absolutePath)
  if (sensitiveSegment) {
    return {
      kind: 'sensitive',
      reason: `Path contains sensitive segment: ${sensitiveSegment}`,
      absolutePath,
    }
  }

  if (!base) {
    return {
      kind: 'outside-workspace',
      reason: 'No workspace is open',
      absolutePath,
    }
  }

  if (isSameOrChildPath(absolutePath, base)) {
    const resource = classifyResourcePath(absolutePath, base)
    if (resource) return resource
    if (isEnablementLedger(absolutePath, base)) {
      return {
        kind: 'sensitive',
        reason: 'Package enablement ledger',
        absolutePath,
      }
    }
    return {
      kind: 'workspace',
      reason: 'Within workspace',
      absolutePath,
    }
  }

  return {
    kind: 'outside-workspace',
    reason: 'Outside workspace',
    absolutePath,
  }
}

function findSensitiveLocation(absolutePath: string): string | null {
  for (const location of SENSITIVE_LOCATIONS) {
    if (location.startsWith('/')) {
      if (absolutePath === location || absolutePath.startsWith(`${location}${sep}`)) {
        return location
      }
      continue
    }

    if (
      absolutePath.endsWith(`${sep}${location}`) ||
      absolutePath.includes(`${sep}${location}${sep}`)
    ) {
      return location
    }
  }
  return null
}

function findSensitiveSegment(absolutePath: string): string | null {
  const segments = absolutePath.split(/[\\/]+/).map(segment => segment.toLowerCase())
  for (const sensitive of SENSITIVE_SEGMENTS) {
    if (segments.includes(sensitive)) return sensitive
  }
  for (const sensitive of SENSITIVE_EXACT_SEGMENTS) {
    if (segments.includes(sensitive)) return sensitive
  }
  for (const prefix of SENSITIVE_PREFIX_SEGMENTS) {
    for (const segment of segments) {
      if (segment === prefix || (segment.startsWith(prefix) && segment.charAt(prefix.length) === '.')) {
        return segment
      }
    }
  }
  for (const segment of segments) {
    if (SENSITIVE_KEY_PATTERN.test(segment)) return segment
  }
  return null
}

// Paths under <workspace>/.mim/resources/ are mounted shared collections.
// They classify as 'resource' so the gate can apply collection write policy.
function classifyResourcePath(absolutePath: string, base: string): PermissionPathClassification | null {
  const segments = relative(base, absolutePath).split(sep)
  if (segments[0] !== '.mim' || segments[1] !== 'resources') return null
  if (segments.length === 2) {
    return {
      kind: 'resource',
      reason: 'Resource mounts directory',
      absolutePath,
      isResourceRoot: true,
    }
  }
  const collectionId = segments[2]
  return {
    kind: 'resource',
    reason: `Shared resource collection: ${collectionId}`,
    absolutePath,
    resourceCollectionId: collectionId,
    isResourceRoot: segments.length === 3,
  }
}

function isEnablementLedger(absolutePath: string, base: string): boolean {
  const rel = relative(base, absolutePath).split(sep)
  return rel.length === 3 && rel[0] === '.mim' && rel[1] === 'packages' && rel[2] === 'enabled.json'
}

function isSameOrChildPath(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`)
}
