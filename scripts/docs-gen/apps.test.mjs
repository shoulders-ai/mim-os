import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findMimAppsPath,
  loadAppManifests,
  generateAppsMarkdown,
  extractFirstParagraph,
} from './apps.mjs'

describe('apps', () => {
  describe('extractFirstParagraph', () => {
    it('extracts the first paragraph, skipping headings', () => {
      const readme = '# Board\n\nA kanban board for issues.\n\n## Features\n\nLots of them.'
      expect(extractFirstParagraph(readme)).toBe('A kanban board for issues.')
    })

    it('joins multi-line paragraphs', () => {
      const readme = '# App\n\nLine one.\nLine two.\n\nAnother para.'
      expect(extractFirstParagraph(readme)).toBe('Line one. Line two.')
    })

    it('returns null for empty README', () => {
      expect(extractFirstParagraph('')).toBeNull()
    })

    it('returns null for heading-only README', () => {
      expect(extractFirstParagraph('# Title\n\n## Section')).toBeNull()
    })

    it('truncates at 300 characters', () => {
      const longParagraph = '# Title\n\n' + 'a'.repeat(400)
      const result = extractFirstParagraph(longParagraph)
      expect(result.length).toBeLessThanOrEqual(300)
    })
  })

  describe('generateAppsMarkdown', () => {
    const apps = [
      {
        id: 'board',
        name: 'Board',
        description: 'Kanban issue board',
        version: '0.1.5',
        readme: '# Board\n\nManage issues on a kanban board.',
        views: [{ id: 'main', label: 'Board', role: 'work' }],
        provides: { tools: [{ name: 'issues.list' }, { name: 'issues.create' }] },
        permissions: {},
      },
    ]

    it('emits valid frontmatter', () => {
      const md = generateAppsMarkdown(apps)
      expect(md).toContain('id: apps')
      expect(md).toContain('title: apps')
      expect(md).toContain('generated: true')
    })

    it('includes the summary table', () => {
      const md = generateAppsMarkdown(apps)
      expect(md).toContain('Apps maintained in the Mim app catalog.')
      expect(md).not.toContain('app registry')
      expect(md).toContain('| Board | Kanban issue board | 0.1.5 |')
    })

    it('includes per-app section with lowercase heading', () => {
      const md = generateAppsMarkdown(apps)
      expect(md).toContain('## board')
    })

    it('lists named tools', () => {
      const md = generateAppsMarkdown(apps)
      expect(md).toContain('`issues.list`')
      expect(md).toContain('`issues.create`')
    })

    it('includes README first paragraph', () => {
      const md = generateAppsMarkdown(apps)
      expect(md).toContain('Manage issues on a kanban board.')
    })

    it('escapes pipes in descriptions', () => {
      const apps2 = [{
        ...apps[0],
        description: 'A | B',
      }]
      const md = generateAppsMarkdown(apps2)
      expect(md).toContain('A \\| B')
    })
  })

  describe('findMimAppsPath', () => {
    it('returns a valid path or null', () => {
      const result = findMimAppsPath()
      // In this test environment the mim-apps repo exists at ~/Desktop/mim-apps
      if (result) {
        expect(typeof result).toBe('string')
      }
    })
  })

  describe('loadAppManifests (integration)', () => {
    it('includes only apps declared by the catalog index', () => {
      const root = mkdtempSync(join(tmpdir(), 'mim-app-docs-'))
      const packagesDir = join(root, 'packages')
      mkdirSync(join(packagesDir, 'board'), { recursive: true })
      mkdirSync(join(packagesDir, 'private-local'), { recursive: true })
      writeFileSync(join(root, 'index.json'), JSON.stringify({
        manifestVersion: 1,
        packages: [{ id: 'board', path: 'packages/board' }],
      }))
      writeFileSync(join(packagesDir, 'board', 'package.json'), JSON.stringify({
        name: '@mim/board',
        version: '1.0.0',
        mim: { id: 'board', name: 'Board' },
      }))
      writeFileSync(join(packagesDir, 'private-local', 'package.json'), JSON.stringify({
        name: '@private/local',
        version: '1.0.0',
        mim: { id: 'private-local', name: 'Private local' },
      }))

      try {
        expect(loadAppManifests(packagesDir).map(app => app.id)).toEqual(['board'])
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })

    it('loads real manifests from mim-apps if available', () => {
      const packagesDir = findMimAppsPath()
      if (!packagesDir) return // skip if not available

      const apps = loadAppManifests(packagesDir)
      expect(apps.length).toBeGreaterThan(0)
      const board = apps.find(a => a.id === 'board')
      if (board) {
        expect(board.name).toBe('Board')
        expect(board.description).toBeTruthy()
      }
    })
  })
})
