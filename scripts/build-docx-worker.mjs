import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const rid = process.argv[2] || detectRid()
const { platform, arch } = ridToPlatformArch(rid)
const project = join(root, 'sidecar', 'docx-worker', 'DocxWorker', 'DocxWorker.csproj')
const publishDir = join(root, 'sidecar', 'docx-worker', 'DocxWorker', 'bin', 'Release', 'net8.0', rid, 'publish')
const resourceDir = join(root, 'resources', 'docx-worker', `${electronBuilderOsName(platform)}-${arch}`)
const targetName = platform === 'win32' ? 'docx-worker.exe' : 'docx-worker'
const legacyName = platform === 'win32' ? 'DocxWorker.exe' : 'DocxWorker'

if (!existsSync(project)) {
  throw new Error(`DOCX worker project not found: ${project}`)
}

execFileSync('dotnet', [
  'publish',
  project,
  '-c',
  'Release',
  '-r',
  rid,
  '--self-contained',
  'true',
  '-p:PublishSingleFile=true',
  '-p:DebugType=None',
  '-p:DebugSymbols=false',
], { stdio: 'inherit' })

const source = [targetName, legacyName]
  .map(name => join(publishDir, name))
  .find(path => existsSync(path))

if (!source) {
  const published = existsSync(publishDir) ? readdirSync(publishDir).join(', ') : 'publish directory missing'
  throw new Error(`Published DOCX worker executable not found in ${publishDir}. Found: ${published}`)
}

mkdirSync(resourceDir, { recursive: true })
const target = join(resourceDir, targetName)
copyFileSync(source, target)
if (platform !== 'win32') chmodSync(target, 0o755)

console.log(`DOCX worker copied: ${basename(source)} -> ${target}`)

function detectRid() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64'
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`)
}

function ridToPlatformArch(rid) {
  const map = {
    'osx-arm64':   { platform: 'darwin',  arch: 'arm64' },
    'osx-x64':     { platform: 'darwin',  arch: 'x64' },
    'win-x64':     { platform: 'win32',   arch: 'x64' },
    'win-arm64':   { platform: 'win32',   arch: 'arm64' },
    'linux-x64':   { platform: 'linux',   arch: 'x64' },
    'linux-arm64': { platform: 'linux',   arch: 'arm64' },
  }
  return map[rid] || { platform: process.platform, arch: process.arch }
}

function electronBuilderOsName(platform) {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return platform
}
