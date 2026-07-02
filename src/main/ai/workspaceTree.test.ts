import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { renderWorkspaceTree } from '@main/ai/workspaceTree.js'

function withWorkspace(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'mim-tree-test-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('renderWorkspaceTree', () => {
  it('renders root entries and one level of child folder contents', () => {
    withWorkspace((dir) => {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      mkdirSync(join(dir, 'src', 'main'), { recursive: true })
      writeFileSync(join(dir, 'README.md'), 'readme')
      writeFileSync(join(dir, 'docs', 'plan.md'), 'plan')
      writeFileSync(join(dir, 'src', 'main', 'index.ts'), 'index')

      const out = renderWorkspaceTree(dir)

      expect(out).toContain('# Workspace tree')
      expect(out).toContain(dir)
      expect(out).toContain('README.md')
      expect(out).toContain('docs/')
      expect(out).toContain('plan.md')
      expect(out).toContain('src/')
      expect(out).toContain('main/')
      expect(out).not.toContain('index.ts')
    })
  })

  it('hides special folder contents', () => {
    withWorkspace((dir) => {
      mkdirSync(join(dir, '.mim'), { recursive: true })
      mkdirSync(join(dir, 'knowledge'), { recursive: true })
      writeFileSync(join(dir, '.mim', 'settings.json'), '{}')
      writeFileSync(join(dir, 'knowledge', 'note.md'), 'secret')

      const out = renderWorkspaceTree(dir)

      expect(out).toContain('.mim/ [contents hidden]')
      expect(out).toContain('knowledge/ [contents hidden]')
      expect(out).not.toContain('settings.json')
      expect(out).not.toContain('note.md')
    })
  })

  it('caps root entries at 50 and child folder entries at 10', () => {
    withWorkspace((dir) => {
      mkdirSync(join(dir, 'docs'), { recursive: true })
      for (let i = 0; i < 55; i += 1) {
        writeFileSync(join(dir, `root-${String(i).padStart(2, '0')}.md`), 'root')
      }
      for (let i = 0; i < 12; i += 1) {
        writeFileSync(join(dir, 'docs', `doc-${String(i).padStart(2, '0')}.md`), 'doc')
      }

      const out = renderWorkspaceTree(dir)

      expect(out).toContain('... 6 more root entries omitted')
      expect(out).toContain('doc-09.md')
      expect(out).not.toContain('doc-10.md')
      expect(out).toContain('... 2 more entries omitted')
    })
  })

  it.skipIf(process.platform === 'win32')('traverses root symlinks for one level only', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mim-tree-outside-'))
    try {
      mkdirSync(join(outside, 'nested'), { recursive: true })
      writeFileSync(join(outside, 'linked-note.md'), 'note')
      writeFileSync(join(outside, 'nested', 'hidden.md'), 'hidden')

      withWorkspace((dir) => {
        symlinkSync(outside, join(dir, 'shared'), 'dir')

        const out = renderWorkspaceTree(dir)

        expect(out).toContain('shared@ ->')
        expect(out).toContain('linked-note.md')
        expect(out).toContain('nested/')
        expect(out).not.toContain('hidden.md')
      })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
