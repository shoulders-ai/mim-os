import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomBytes } from 'crypto'

/**
 * Write a JSON value to `path` atomically: serialise to a temporary file in
 * the same directory, then rename over the target.  If serialisation or the
 * write itself throws, the original file (if any) is untouched and no tmp
 * file is left behind.
 */
export function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const suffix = randomBytes(6).toString('hex')
  const tmp = `${path}.tmp-${suffix}`
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
    renameSync(tmp, path)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* tmp may not exist if stringify threw */ }
    throw err
  }
}
