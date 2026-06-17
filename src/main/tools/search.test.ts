import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerSearchTools } from '@main/tools/search.js'
import { searchSessions } from '@main/search/search.js'

// Session search is backed by a SQLite FTS database (a storage boundary, and a
// native module compiled for Electron's ABI) — mock that module and assert
// dispatch. File search runs against real files on disk.
vi.mock('@main/search/search.js', () => ({
  searchSessions: vi.fn(() => [
    { sessionId: 's1', label: 'Sprint planning', messageIdx: 0, role: 'user', excerpt: 'deploy pipeline' },
  ]),
}))

const mockedSearchSessions = vi.mocked(searchSessions)

describe('Search tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    vi.clearAllMocks()
    dir = mkdtempSync(join(tmpdir(), 'mim-search-tools-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerSearchTools(tools)

    writeFileSync(join(dir, 'notes.md'), 'shopping list\nthe deploy pipeline is broken\nend')
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src/run.ts'), '// deploy pipeline helper')
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/pkg/index.js'), 'deploy pipeline inside dependency')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('search.files', () => {
    it('finds matches in real workspace files with path, line, and snippet', async () => {
      const result = await tools.call('search.files', { query: 'deploy pipeline' }, ctx) as {
        results: Array<{ path: string; line: number; snippet: string }>
      }

      const paths = result.results.map(r => r.path).sort()
      expect(paths).toEqual(['notes.md', 'src/run.ts'])

      const noteHit = result.results.find(r => r.path === 'notes.md')!
      expect(noteHit.line).toBe(2)
      expect(noteHit.snippet).toContain('deploy pipeline')
    })

    it('skips node_modules', async () => {
      const result = await tools.call('search.files', { query: 'deploy pipeline' }, ctx) as {
        results: Array<{ path: string }>
      }
      expect(result.results.every(r => !r.path.startsWith('node_modules'))).toBe(true)
    })

    it('filters by glob pattern', async () => {
      const result = await tools.call('search.files', {
        query: 'deploy pipeline',
        pattern: '*.md',
      }, ctx) as { results: Array<{ path: string }> }

      expect(result.results.map(r => r.path)).toEqual(['notes.md'])
    })

    it('caps results at max_results', async () => {
      writeFileSync(join(dir, 'many.txt'), Array.from({ length: 10 }, () => 'deploy pipeline').join('\n'))

      const result = await tools.call('search.files', {
        query: 'deploy pipeline',
        max_results: 3,
      }, ctx) as { results: unknown[] }

      expect(result.results).toHaveLength(3)
    })

    it('rejects a missing query', async () => {
      await expect(tools.call('search.files', {}, ctx))
        .rejects.toThrow('Missing required parameter: query')
    })

    it('rejects when no workspace is open', async () => {
      const bare = createToolRegistry(createTraceLog())
      registerSearchTools(bare)
      await expect(bare.call('search.files', { query: 'anything' }, ctx))
        .rejects.toThrow('No workspace open')
    })
  })

  describe('search.sessions', () => {
    it('dispatches to session search with the query and a default limit of 30', async () => {
      const result = await tools.call('search.sessions', { query: 'deploy' }, ctx) as {
        results: Array<{ sessionId: string }>
      }

      expect(mockedSearchSessions).toHaveBeenCalledWith('deploy', 30)
      expect(result.results[0].sessionId).toBe('s1')
    })

    it('passes max_results through', async () => {
      await tools.call('search.sessions', { query: 'deploy', max_results: 5 }, ctx)
      expect(mockedSearchSessions).toHaveBeenCalledWith('deploy', 5)
    })

    it('rejects a missing query', async () => {
      await expect(tools.call('search.sessions', {}, ctx))
        .rejects.toThrow('Missing required parameter: query')
      expect(mockedSearchSessions).not.toHaveBeenCalled()
    })
  })

  describe('unified search dispatcher', () => {
    it('defaults to scope "all": both files and sessions, limit 20', async () => {
      const result = await tools.call('search', { query: 'deploy pipeline' }, ctx) as {
        files?: Array<{ path: string }>
        sessions?: Array<{ sessionId: string }>
      }

      expect(mockedSearchSessions).toHaveBeenCalledWith('deploy pipeline', 20)
      expect(result.sessions?.[0].sessionId).toBe('s1')
      expect(result.files?.map(f => f.path).sort()).toEqual(['notes.md', 'src/run.ts'])
    })

    it('scope "files" searches only files', async () => {
      const result = await tools.call('search', { query: 'deploy pipeline', scope: 'files' }, ctx) as {
        files?: unknown[]
        sessions?: unknown[]
      }

      expect(mockedSearchSessions).not.toHaveBeenCalled()
      expect(result.sessions).toBeUndefined()
      expect(result.files).toHaveLength(2)
    })

    it('scope "sessions" searches only sessions', async () => {
      const result = await tools.call('search', { query: 'deploy pipeline', scope: 'sessions' }, ctx) as {
        files?: unknown[]
        sessions?: unknown[]
      }

      expect(mockedSearchSessions).toHaveBeenCalledWith('deploy pipeline', 20)
      expect(result.files).toBeUndefined()
      expect(result.sessions).toHaveLength(1)
    })

    it('forwards file_pattern and max_results to file search', async () => {
      writeFileSync(join(dir, 'extra.md'), 'deploy pipeline\ndeploy pipeline\ndeploy pipeline')

      const result = await tools.call('search', {
        query: 'deploy pipeline',
        scope: 'files',
        file_pattern: '*.md',
        max_results: 2,
      }, ctx) as { files: Array<{ path: string }> }

      expect(result.files).toHaveLength(2)
      expect(result.files.every(f => f.path.endsWith('.md'))).toBe(true)
    })

    it('omits files (without failing) when no workspace is open', async () => {
      const bare = createToolRegistry(createTraceLog())
      registerSearchTools(bare)

      const result = await bare.call('search', { query: 'deploy' }, ctx) as {
        files?: unknown[]
        sessions?: unknown[]
      }

      expect(result.files).toBeUndefined()
      expect(result.sessions).toHaveLength(1)
    })

    it('rejects a missing query', async () => {
      await expect(tools.call('search', { scope: 'all' }, ctx))
        .rejects.toThrow('Missing required parameter: query')
    })
  })
})
