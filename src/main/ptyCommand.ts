import { defaultShell } from '@main/platform.js'

export interface NormalizedPtyCommand {
  file: string
  args: string[]
}

export function normalizePtySpawnCommand(
  file: string,
  args: string[],
  options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
  } = {},
): NormalizedPtyCommand {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args }

  return {
    file: defaultShell(options.env, 'win32'),
    args: ['/d', '/s', '/c', [quoteCmd(file), ...args.map(quoteCmd)].join(' ')],
  }
}

function quoteCmd(value: string): string {
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
