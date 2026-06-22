import { execFile } from 'child_process'

export interface AgentMcpSetup {
  addArgs: string[]
  removeArgs: string[]
  listArgs: string[]
}

const SETUPS: Record<string, AgentMcpSetup> = {
  'claude-code': {
    addArgs: ['mcp', 'add', 'mim', '--', 'mim', 'mcp'],
    removeArgs: ['mcp', 'remove', 'mim'],
    listArgs: ['mcp', 'list'],
  },
  'codex': {
    addArgs: ['mcp', 'add', 'mim', '--', 'mim', 'mcp'],
    removeArgs: ['mcp', 'remove', 'mim'],
    listArgs: ['mcp', 'list'],
  },
  'gemini-cli': {
    addArgs: ['mcp', 'add', 'mim', 'mim', 'mcp'],
    removeArgs: ['mcp', 'remove', 'mim'],
    listArgs: ['mcp', 'list'],
  },
}

export function getAgentMcpSetup(agentId: string): AgentMcpSetup | null {
  return SETUPS[agentId] ?? null
}

export type ExecCommand = (binPath: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

const defaultExec: ExecCommand = (binPath, args) =>
  new Promise((resolve, reject) => {
    execFile(binPath, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(error)
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })

export async function checkMimMcpConfigured(
  binPath: string,
  listArgs: string[],
  exec: ExecCommand = defaultExec,
): Promise<boolean> {
  try {
    const { stdout, stderr } = await exec(binPath, listArgs)
    return /\bmim\b/i.test(stdout + stderr)
  } catch {
    return false
  }
}

export async function addMimMcp(
  binPath: string,
  addArgs: string[],
  exec: ExecCommand = defaultExec,
): Promise<void> {
  await exec(binPath, addArgs)
}

export async function removeMimMcp(
  binPath: string,
  removeArgs: string[],
  exec: ExecCommand = defaultExec,
): Promise<void> {
  await exec(binPath, removeArgs)
}
