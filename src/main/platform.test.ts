import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { defaultShell, electronBuilderOsName, toSlashPath, userHomeDir } from '@main/platform.js'

describe('platform helpers', () => {
  it('uses HOME before USERPROFILE for user-global Mim paths', () => {
    expect(userHomeDir({ HOME: '/home/mim', USERPROFILE: 'C:\\Users\\Mim' } as NodeJS.ProcessEnv))
      .toBe('/home/mim')
  })

  it('uses USERPROFILE when HOME is missing on Windows-style environments', () => {
    expect(userHomeDir({ USERPROFILE: 'C:\\Users\\Mim' } as NodeJS.ProcessEnv))
      .toBe('C:\\Users\\Mim')
  })

  it('uses a platform-appropriate shell fallback', () => {
    expect(defaultShell({} as NodeJS.ProcessEnv, 'linux')).toBe('/bin/sh')
    expect(defaultShell({} as NodeJS.ProcessEnv, 'darwin')).toBe('/bin/zsh')
    expect(defaultShell({ COMSPEC: 'C:\\Windows\\System32\\cmd.exe' } as NodeJS.ProcessEnv, 'win32'))
      .toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('normalizes renderer-facing relative paths to forward slashes', () => {
    expect(toSlashPath(join('src', 'main', 'index.ts'))).toBe('src/main/index.ts')
    expect(toSlashPath('src\\main\\index.ts')).toBe('src/main/index.ts')
  })

  it('returns electron-builder OS macro names', () => {
    expect(electronBuilderOsName('darwin')).toBe('mac')
    expect(electronBuilderOsName('win32')).toBe('win')
    expect(electronBuilderOsName('linux')).toBe('linux')
  })
})
