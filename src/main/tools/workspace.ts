import { existsSync, mkdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { classifyWorkspace, scaffoldWorkspace, parseMimYaml, DEFAULT_AGENTS_MD } from '@main/workspace/workspaceContract.js'
import { writeAgentContext } from '@main/ai/agentContext.js'
import { atomicWriteJson } from '@main/atomicJson.js'
import { readSharedWorkspaceConfig } from '@main/workspace/sharedWorkspaceMount.js'
import { readSharedWorkspaceToken, sharedWorkspaceTokenEnvKey } from '@main/workspace/sharedWorkspaceTokens.js'
import {
  inspectSharedWorkspaceInvite,
  joinSharedWorkspaceFromInvite,
} from '@main/workspace/sharedWorkspaceInvite.js'

interface WorkspaceConfig {
  name: string
  created: string
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerWorkspaceTools(tools: ToolRegistry): void {

  tools.register({
    name: 'workspace.status',
    description: 'Report whether the current workspace has been initialized with the Mim contract files.',
    inputSchema: objectSchema({ path: { type: 'string' } }),
    execute: async (params) => {
      const path = (params.path as string) || tools.getWorkspacePath()
      if (!path) throw new Error('No workspace is open')
      return { ...classifyWorkspace(path), path }
    }
  })

  tools.register({
    name: 'workspace.init',
    description: 'Initialize the current workspace: write mim.yaml, AGENTS.md, CLAUDE.md, .mim/, and .gitignore.',
    inputSchema: objectSchema({ name: { type: 'string' } }),
    execute: async (params) => {
      const path = tools.getWorkspacePath()
      if (!path) throw new Error('No workspace is open')
      const name = (params.name as string) || basename(path)
      const { created } = scaffoldWorkspace(path, { name })
      return { initialized: true, created, path }
    }
  })

  tools.register({
    name: 'workspace.open',
    description: 'Open a folder as a workspace. Creates .mim/ if needed.',
    execute: async (params) => {
      const path = params.path as string
      if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`)

      tools.setWorkspacePath(path)

      const mimDir = join(path, '.mim')
      const configPath = join(mimDir, 'workspace.json')

      if (!existsSync(configPath)) {
        mkdirSync(mimDir, { recursive: true })
        const config: WorkspaceConfig = {
          name: path.split('/').pop() ?? 'workspace',
          created: new Date().toISOString()
        }
        atomicWriteJson(configPath, config)
      }

      // Regenerate the volatile runtime context. Best-effort; never block workspace open on failure.
      try {
        await writeAgentContext(path)
      } catch {
        // best-effort; a generation failure must not break workspace open
      }

      return { opened: path }
    }
  })

  tools.register({
    name: 'workspace.orient',
    description: 'Regenerate the runtime agent context file (.mim/agent-context.md) for the current workspace and return it.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const path = tools.getWorkspacePath()
      if (!path) throw new Error('No workspace open')
      return writeAgentContext(path)
    }
  })

  tools.register({
    name: 'workspace.info',
    description: 'Get info about the current workspace',
    inputSchema: objectSchema({}),
    execute: async () => {
      const path = tools.getWorkspacePath()
      if (!path) return { open: false }

      const contract = classifyWorkspace(path)

      // Authoritative name comes from mim.yaml when present; otherwise folder basename.
      let name = basename(path)
      const mimYamlPath = join(path, 'mim.yaml')
      if (existsSync(mimYamlPath)) {
        const parsed = parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
        if (parsed.name) name = parsed.name
      }

      const configPath = join(path, '.mim', 'workspace.json')
      let config: WorkspaceConfig | null = null
      if (existsSync(configPath)) {
        config = JSON.parse(readFileSync(configPath, 'utf-8'))
      }

      return { open: true, path, name, initialized: contract.initialized, missing: contract.missing, config }
    }
  })

  tools.register({
    name: 'workspace.sharedWorkspace.status',
    description: 'Report the configured shared workspace client mount without exposing its bearer token.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const path = tools.getWorkspacePath()
      if (!path) return { configured: false }
      const config = readSharedWorkspaceConfig(path)
      if (!config) return { configured: false }
      return {
        configured: true,
        id: config.id,
        name: config.name,
        url: config.url,
        namespaces: config.namespaces,
        tokenConfigured: readSharedWorkspaceToken(config.id) !== null,
        tokenKey: sharedWorkspaceTokenEnvKey(config.id),
      }
    },
  })

  tools.register({
    name: 'workspace.sharedWorkspace.inspectInvite',
    description: 'Inspect a shared workspace invite for confirmation without redeeming it.',
    inputSchema: objectSchema({ invite: { type: 'string' } }, ['invite']),
    execute: async (params) => {
      const invite = typeof params.invite === 'string' ? params.invite : ''
      if (!invite.trim()) throw new Error('Shared workspace invite is required')
      return inspectSharedWorkspaceInvite(invite)
    },
  })

  tools.register({
    name: 'workspace.sharedWorkspace.join',
    description: 'Redeem a shared workspace invite and configure this workspace without exposing the token.',
    inputSchema: objectSchema({ invite: { type: 'string' } }, ['invite']),
    execute: async (params) => {
      const path = tools.getWorkspacePath()
      if (!path) throw new Error('No workspace is open')
      const invite = typeof params.invite === 'string' ? params.invite : ''
      if (!invite.trim()) throw new Error('Shared workspace invite is required')
      return joinSharedWorkspaceFromInvite({ workspacePath: path, invite })
    },
  })

  tools.register({
    name: 'workspace.defaultAgentsMd',
    description: 'Return the default AGENTS.md template content.',
    inputSchema: objectSchema({}),
    execute: async () => ({ content: DEFAULT_AGENTS_MD }),
  })
}
