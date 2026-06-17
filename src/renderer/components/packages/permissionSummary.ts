// Plain-language rendering of a package's declared permissions, used wherever
// the user decides to add or trust an app. One line per granted capability;
// permissions the package did not declare are omitted entirely.

export function permissionLines(permissions: Record<string, unknown>): string[] {
  const lines: string[] = []

  const workspace = permissions.workspace as { read?: boolean; write?: boolean } | undefined
  if (workspace?.write === true) lines.push('Read and edit files in this workspace')
  else if (workspace?.read === true) lines.push('Read files in this workspace')

  if (permissions.ai === true) lines.push('Use AI from its backend')

  const http = permissions.http
  if (Array.isArray(http) && http.length > 0) {
    lines.push(`Connect to ${http.map(String).join(', ')}`)
  }

  const secrets = permissions.secrets
  if (Array.isArray(secrets) && secrets.length > 0) {
    const names = secrets.map(String).join(', ')
    lines.push(`Use your ${names} secret${secrets.length > 1 ? 's' : ''} from the system keychain`)
  }

  if (lines.length === 0) lines.push('No special access')
  return lines
}
