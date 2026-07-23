import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { createSkillLoader } from '@main/skills.js'
import { parsePackageManifest } from '@main/packages/packageManifest.js'

describe('external resource loading', () => {
  let externalRoot: string

  beforeEach(() => {
    externalRoot = mkdtempSync(join(tmpdir(), 'mim-external-source-'))

    const skillDir = join(externalRoot, 'skills', 'greet')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: greet',
      'description: Use when the user wants a friendly greeting or needs a morale boost.',
      '---',
      '',
      'Write a warm and encouraging message.',
    ].join('\n'))

    const packageDir = join(externalRoot, 'packages', 'ext-demo')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'backend.mjs'), 'export const tools = {}\n')
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: '@mim/ext-demo',
      version: '0.1.0',
      mim: {
        manifestVersion: 1,
        id: 'ext-demo',
        name: 'External Demo',
        views: [],
        backend: './backend.mjs',
        permissions: {},
        provides: { tools: ['demo.greet', 'demo.status'] },
      },
    }))
  })

  afterEach(() => {
    rmSync(externalRoot, { recursive: true, force: true })
  })

  describe('skills from the Team source folder', () => {
    it('discovers the greet skill from the Team root', () => {
      const loader = createSkillLoader({
        builtinDir: '/nonexistent-builtin',
        personalDir: '/nonexistent-personal',
        teamDir: join(externalRoot, 'skills'),
        teamName: 'External Test',
      })

      const skills = loader.list()
      const greet = skills.find(s => s.name === 'greet')
      expect(greet).toBeDefined()
      expect(greet!.source).toBe('team')
      expect(greet!.sourceName).toBe('External Test')
      expect(greet!.description).toBe('Use when the user wants a friendly greeting or needs a morale boost.')
    })

    it('loads the full skill body via get()', () => {
      const loader = createSkillLoader({
        builtinDir: '/nonexistent-builtin',
        personalDir: '/nonexistent-personal',
        teamDir: join(externalRoot, 'skills'),
        teamName: 'External Test',
      })

      const skill = loader.get('greet')
      expect(skill).toBeDefined()
      expect(skill!.body).toContain('warm and encouraging message')
    })
  })

  describe('app from an external folder', () => {
    it('does not require an index.json — the folder has none', () => {
      expect(existsSync(join(externalRoot, 'index.json'))).toBe(false)
    })

    it('parses the app manifest from the external app dir', () => {
      const packageDir = join(externalRoot, 'packages', 'ext-demo')
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
