import { homedir } from 'os'

export function userHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HOME || env.USERPROFILE
  if (explicit && explicit.trim()) return explicit
  return homedir()
}

export function defaultShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') return env.ComSpec || env.COMSPEC || 'cmd.exe'
  if (env.SHELL && env.SHELL.trim()) return env.SHELL
  return platform === 'darwin' ? '/bin/zsh' : '/bin/sh'
}

export function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}

export function electronBuilderOsName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return platform
}
