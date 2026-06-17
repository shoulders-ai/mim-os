/**
 * Structured error types for the package SDK surface.
 * These carry machine-readable codes so package authors can handle
 * specific failure modes without parsing error message strings.
 */

export type PackageErrorCode =
  | 'PERMISSION_DENIED'
  | 'PERMISSION_NOT_DECLARED'
  | 'HOST_NOT_ALLOWED'
  | 'SECRET_NOT_DECLARED'

export class PackagePermissionError extends Error {
  readonly code: PackageErrorCode
  readonly permission: string

  constructor(code: PackageErrorCode, permission: string, message: string) {
    super(message)
    this.name = 'PackagePermissionError'
    this.code = code
    this.permission = permission
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      permission: this.permission,
      message: this.message,
    }
  }
}
