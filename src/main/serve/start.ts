import { createHeadlessKernel } from '@main/headless.js'
import { createServer } from '@main/server/server.js'
import {
  createServeRemoteGrantResolver,
  hasActiveServeCallers,
  validateServeToken,
} from '@main/serve/tokens.js'
import { hasRedeemableServeInvites, redeemServeInvite } from '@main/serve/invites.js'
import { recordServeDeniedRequest } from '@main/serve/denials.js'

export interface StartMimServeOptions {
  workspacePath: string
  host: string
  port: number
  home?: string
  stdout?: (text: string) => void
}

export async function startMimServe(options: StartMimServeOptions): Promise<number> {
  if (!hasActiveServeCallers(options) && !hasRedeemableServeInvites(options)) {
    throw new Error('No active serve callers or invites. Run `mim serve invite create --name <name>` first.')
  }

  const kernel = createHeadlessKernel({
    approvals: 'deny',
    resolveRemoteGrant: createServeRemoteGrantResolver({
      home: options.home,
      workspacePath: options.workspacePath,
    }),
    onGateDecision: (event) => {
      recordServeDeniedRequest({
        home: options.home,
        workspacePath: options.workspacePath,
        event,
      })
    },
  })
  await kernel.openWorkspace(options.workspacePath)
  const server = await createServer(kernel.tools, kernel.getPackages(), {
    mode: 'serve',
    host: options.host,
    port: options.port,
    getNamedMcpTools: () => kernel.getNamedMcpTools(),
    agentMounts: kernel.getAgentMounts() ?? undefined,
    authenticateMcpHttpToken: async (token) => validateServeToken({
      home: options.home,
      workspacePath: options.workspacePath,
      token,
    }),
    redeemSharedWorkspaceInvite: (invite) => redeemServeInvite({
      home: options.home,
      workspacePath: options.workspacePath,
      invite,
    }),
  })

  options.stdout?.(`mim serve listening on http://${options.host}:${server.port}/mcp\n`)

  try {
    await waitForShutdownSignal()
    return 0
  } finally {
    server.close()
    await kernel.shutdown()
  }
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      resolve()
    }
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
  })
}
