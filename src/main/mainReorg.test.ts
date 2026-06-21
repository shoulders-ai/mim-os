import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

const mainRoot = fileURLToPath(new URL('.', import.meta.url))

const expectedMovedModules = [
  ['ai/agentContext.ts', 'ai/agentContext.test.ts'],
  ['ai/ai.ts', 'ai/ai.test.ts'],
  ['ai/aiRuntime.ts', 'ai/aiRuntime.test.ts'],
  ['ai/systemPrompt.ts', 'ai/systemPrompt.test.ts'],
  ['packages/packageData.ts', 'packages/packageData.test.ts'],
  ['packages/packageEnablement.ts', 'packages/packageEnablement.test.ts'],
  ['packages/packageHttp.ts', 'packages/packageHttp.test.ts'],
  ['packages/packageJobs.ts', 'packages/packageJobs.test.ts'],
  ['packages/packageManifest.ts', 'packages/packageManifest.test.ts'],
  ['packages/packageRuntime.ts', 'packages/packageRuntime.test.ts'],
  ['packages/packageSecrets.ts', 'packages/packageSecrets.test.ts'],
  ['packages/packages.ts', 'packages/packages.test.ts'],
  ['resources/resourceModel.ts', 'resources/resourceModel.test.ts'],
  ['search/fileSearch.ts', 'search/fileSearch.test.ts'],
  ['search/search.ts', 'search/search.test.ts'],
  ['search/searchText.ts', 'search/searchText.test.ts'],
  ['search/textMatch.ts', 'search/textMatch.test.ts'],
  ['security/gate-paths.ts', 'security/gate-paths.test.ts'],
	  ['security/gate.ts', 'security/gate.test.ts'],
	  ['server/server.ts', 'server/server.test.ts'],
	  ['server/server-ai.test.ts'],
	  ['mcp/stdio.ts', 'mcp/stdio.test.ts'],
	  ['mcp/discovery.ts'],
	  ['tools/registry.ts', 'tools/registry.test.ts'],
  ['trace/trace.ts', 'trace/trace.test.ts'],
  ['workspace/workspaceBoot.ts', 'workspace/workspaceBoot.test.ts'],
  ['workspace/workspaceContract.ts', 'workspace/workspaceContract.test.ts'],
  ['workspace/workspaceFileWatcher.ts', 'workspace/workspaceFileWatcher.test.ts'],
]

const expectedRootFiles = new Set([
  'atomicJson.test.ts',
  'atomicJson.ts',
  'attachments.test.ts',
  'attachments.ts',
  'autoUpdater.test.ts',
  'autoUpdater.ts',
  'cli.test.ts',
  'cli.ts',
  'closeGuard.test.ts',
  'closeGuard.ts',
  'ext-resource-loading.test.ts',
  'git.test.ts',
  'git.ts',
  'headless.test.ts',
  'headless.ts',
  'htmlPdf.ts',
  'index.security.test.ts',
  'index.ts',
  'logbook.test.ts',
  'logbook.ts',
  'mainReorg.test.ts',
  'menu.test.ts',
  'menu.ts',
  'platform.test.ts',
  'platform.ts',
  'pty.ts',
  'ptyCommand.test.ts',
  'ptyCommand.ts',
  'sessionManifest.test.ts',
  'sessionManifest.ts',
  'sessions.test.ts',
  'sessions.ts',
  'skills.test.ts',
  'skills.ts',
  'userConfig.test.ts',
  'userConfig.ts',
])

const importPattern =
  /(?:\bfrom\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\bvi\.mock\(\s*['"]([^'"]+)['"])/g

function walkTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return walkTsFiles(path)
    return entry.endsWith('.ts') ? [path] : []
  })
}

function sourcePathForImport(file: string, specifier: string): string | null {
  if (specifier.startsWith('@main/')) {
    return join(mainRoot, specifier.slice('@main/'.length).replace(/\.js$/, '.ts'))
  }
  if (specifier.startsWith('.')) {
    return resolve(dirname(file), specifier.replace(/\.js$/, '.ts'))
  }
  return null
}

describe('src/main reorganization contract', () => {
  it('keeps approved domains grouped and issues/knowledge app models flat', () => {
    const missing = expectedMovedModules.flat().filter((path) => !existsSync(join(mainRoot, path)))
    expect(missing).toEqual([])

    const rootTsFiles = readdirSync(mainRoot)
      .filter((entry) => entry.endsWith('.ts') && statSync(join(mainRoot, entry)).isFile())
      .sort()

    expect(rootTsFiles).toEqual([...expectedRootFiles].sort())
  })

  it('resolves every local src/main import and module mock target', () => {
    const missing: string[] = []

    for (const file of walkTsFiles(mainRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1] ?? match[2] ?? match[3]
        const resolved = sourcePathForImport(file, specifier)
        if (!resolved) continue
        if (!existsSync(resolved)) {
          missing.push(`${relative(mainRoot, file)} -> ${specifier}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})
