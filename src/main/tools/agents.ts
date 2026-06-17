import type { ToolRegistry } from '@main/tools/registry.js'
import { detectAgents, type DetectedAgent } from '@main/agents/agentCatalog.js'
import type { AgentSessions } from '@main/agents/agentSessions.js'

export interface AgentToolsDeps {
  // System boundaries: injected by tests so agent tools never spawn a login
  // shell or a real pty.
  detect?: () => Promise<DetectedAgent[]>
  sessions?: AgentSessions
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerAgentTools(tools: ToolRegistry, deps?: AgentToolsDeps): void {
  const detect = deps?.detect ?? (() => detectAgents())
  const sessions = (): AgentSessions => {
    if (!deps?.sessions) throw new Error('Agent sessions are not available in this runtime')
    return deps.sessions
  }

  tools.register({
    name: 'agent.list',
    description: 'CLI coding agents (Claude Code, Codex, Gemini CLI) detected on this machine, with absolute binary paths resolved through the user\'s login shell.',
    inputSchema: objectSchema({}),
    execute: async () => ({ agents: await detect() }),
  })

  tools.register({
    name: 'agent.launch',
    description: 'Launch a detected CLI agent as an interactive pty session in the workspace root. User-only: denied to AI and package actors.',
    inputSchema: objectSchema({
      agentId: { type: 'string' },
      extraArgs: { type: 'array', items: { type: 'string' } },
    }, ['agentId']),
    execute: async (params) => {
      const agentId = params.agentId as string
      const agents = await detect()
      const agent = agents.find(a => a.id === agentId)
      if (!agent) throw new Error(`Unknown agent: ${agentId}`)
      if (!agent.installed || !agent.binPath) throw new Error(`Agent not installed: ${agentId}`)
      const extra = Array.isArray(params.extraArgs) ? params.extraArgs as string[] : []
      const launched = extra.length
        ? { ...agent, args: [...agent.args, ...extra] }
        : agent
      const { record, ptyId } = sessions().launch(launched)
      return { session: record, ptyId }
    },
  })

  tools.register({
    name: 'agent.stop',
    description: 'Stop a running agent session. User-only: denied to AI and package actors.',
    inputSchema: objectSchema({ sessionId: { type: 'string' } }, ['sessionId']),
    execute: async (params) => ({ session: sessions().stop(params.sessionId as string) }),
  })

  tools.register({
    name: 'agent.sessions.list',
    description: 'Agent session records (non-archived), merged with live runtime state (ptyId, working/needs-input).',
    inputSchema: objectSchema({}),
    execute: async () => ({ sessions: sessions().list() }),
  })

  tools.register({
    name: 'agent.sessions.get',
    description: 'One agent session record; pass scrollback=true to include the captured terminal scrollback text.',
    inputSchema: objectSchema({ sessionId: { type: 'string' }, scrollback: { type: 'boolean' } }, ['sessionId']),
    execute: async (params) => {
      const sessionId = params.sessionId as string
      const session = sessions().get(sessionId, { scrollback: params.scrollback === true })
      if (!session) throw new Error(`Agent session not found: ${sessionId}`)
      return { session }
    },
  })

  tools.register({
    name: 'agent.sessions.rename',
    description: 'Rename an agent session',
    inputSchema: objectSchema({ sessionId: { type: 'string' }, title: { type: 'string' } }, ['sessionId', 'title']),
    execute: async (params) => ({ session: sessions().rename(params.sessionId as string, params.title as string) }),
  })

  tools.register({
    name: 'agent.sessions.archive',
    description: 'Archive (default) or restore an agent session via archived=false.',
    inputSchema: objectSchema({ sessionId: { type: 'string' }, archived: { type: 'boolean' } }, ['sessionId']),
    execute: async (params) => ({
      session: sessions().archive(params.sessionId as string, params.archived !== false),
    }),
  })

  tools.register({
    name: 'agent.sessions.delete',
    description: 'Delete an agent session record and its scrollback file. Fails while the session is running.',
    inputSchema: objectSchema({ sessionId: { type: 'string' } }, ['sessionId']),
    execute: async (params) => sessions().delete(params.sessionId as string),
  })
}
