import { describe, expect, it } from 'vitest'
import { normalizePtySpawnCommand } from '@main/ptyCommand.js'

describe('normalizePtySpawnCommand', () => {
  it('keeps native executables direct', () => {
    expect(normalizePtySpawnCommand('/usr/bin/codex', ['--help'], { platform: 'linux' }))
      .toEqual({ file: '/usr/bin/codex', args: ['--help'] })
    expect(normalizePtySpawnCommand('C:\\Tools\\codex.exe', ['--help'], { platform: 'win32' }))
      .toEqual({ file: 'C:\\Tools\\codex.exe', args: ['--help'] })
  })

  it('wraps Windows cmd shims through cmd.exe so CreateProcess can launch them', () => {
    expect(normalizePtySpawnCommand(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd',
      ['--flag', 'value with space'],
      { platform: 'win32', env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' } as NodeJS.ProcessEnv },
    )).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd --flag "value with space"',
      ],
    })
  })
})
