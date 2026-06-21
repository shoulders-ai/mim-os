import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { existsSync } from 'fs'
import { createSkillLoader } from '@main/skills.js'
import { parsePackageManifest } from '@main/packages/packageManifest.js'
import { readFileSync } from 'fs'

const EXT_ROOT = join(process.env.HOME!, 'Desktop', 'ext-test')

describe('external resource loading', () => {
  describe('skills from an external source folder', () => {
    it('discovers the greet skill from the external source root', () => {
      const loader = createSkillLoader({
        builtinDir: '/nonexistent-builtin',
        personalDir: '/nonexistent-personal',
        getSourceSkillRoots: () => [{
          id: 'ext-test',
          name: 'External Test',
          dir: join(EXT_ROOT, 'skills'),
        }],
      })

      const skills = loader.list()
      const greet = skills.find(s => s.name === 'greet')
      expect(greet).toBeDefined()
      expect(greet!.source).toBe('source')
      expect(greet!.sourceId).toBe('ext-test')
      expect(greet!.description).toBe('Use when the user wants a friendly greeting or needs a morale boost.')
    })

    it('loads the full skill body via get()', () => {
      const loader = createSkillLoader({
        builtinDir: '/nonexistent-builtin',
        personalDir: '/nonexistent-personal',
        getSourceSkillRoots: () => [{
          id: 'ext-test',
          name: 'External Test',
          dir: join(EXT_ROOT, 'skills'),
        }],
      })

      const skill = loader.get('greet')
      expect(skill).toBeDefined()
      expect(skill!.body).toContain('warm and encouraging message')
    })
  })

  describe('app from an external folder', () => {
    it('does not require an index.json — the folder has none', () => {
      expect(existsSync(join(EXT_ROOT, 'index.json'))).toBe(false)
    })

    it('parses the app manifest from the external app dir', () => {
      const packageDir = join(EXT_ROOT, 'packages', 'ext-demo')
      const raw = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'))
      const { manifest, diagnostics } = parsePackageManifest(raw, packageDir)

      expect(diagnostics).toHaveLength(0)
      expect(manifest).toBeDefined()
      expect(manifest!.id).toBe('ext-demo')
      expect(manifest!.name).toBe('External Demo')
      expect(manifest!.version).toBe('0.1.0')
      expect(manifest!.backend).toBe('./backend.mjs')
      expect(manifest!.provides?.tools).toHaveLength(2)
      expect(manifest!.provides?.tools[0].pattern).toBe('demo.greet')
    })
  })
})
