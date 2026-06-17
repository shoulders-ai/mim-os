#!/usr/bin/env node

import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, '../out/main/cli.js')

if (!existsSync(entry)) {
  process.stderr.write('Mim CLI is not built. Run `npm run build` first.\n')
  process.exit(1)
}

const mod = await import(pathToFileURL(entry).href)
const code = await mod.runCli(process.argv.slice(2))
process.exitCode = code
