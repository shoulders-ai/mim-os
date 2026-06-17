import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const osName = electronBuilderOsName(process.platform)
const arch = process.arch
const executable = process.platform === 'win32' ? 'docx-worker.exe' : 'docx-worker'
const path = join(root, 'resources', 'docx-worker', `${osName}-${arch}`, executable)

if (!existsSync(path) || !statSync(path).isFile()) {
  throw new Error(`DOCX worker resource missing: ${path}`)
}

console.log(`DOCX worker resource verified: ${path}`)

function electronBuilderOsName(platform) {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return platform
}
