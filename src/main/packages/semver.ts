const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/

export function isValidSemver(version: string): boolean {
  if (!SEMVER_RE.test(version)) return false
  if (version.includes('/') || version.includes('\\')) return false
  return true
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string | undefined
}

function parse(version: string): ParsedVersion {
  const plusIdx = version.indexOf('+')
  const withoutBuild = plusIdx >= 0 ? version.slice(0, plusIdx) : version

  const dashIdx = withoutBuild.indexOf('-')
  let core: string
  let prerelease: string | undefined
  if (dashIdx >= 0) {
    core = withoutBuild.slice(0, dashIdx)
    prerelease = withoutBuild.slice(dashIdx + 1)
  } else {
    core = withoutBuild
  }

  const parts = core.split('.')
  return {
    major: parseInt(parts[0], 10),
    minor: parseInt(parts[1], 10),
    patch: parseInt(parts[2], 10),
    prerelease,
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)

  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch

  if (pa.prerelease === undefined && pb.prerelease === undefined) return 0
  if (pa.prerelease !== undefined && pb.prerelease === undefined) return -1
  if (pa.prerelease === undefined && pb.prerelease !== undefined) return 1
  if (pa.prerelease! < pb.prerelease!) return -1
  if (pa.prerelease! > pb.prerelease!) return 1
  return 0
}
