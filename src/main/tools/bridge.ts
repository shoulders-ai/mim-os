import { BrowserWindow } from 'electron'
import type { ToolRegistry } from '@main/tools/registry.js'

function sendToRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) {
    throw new Error('No window available')
  }
  windows[0].webContents.send(channel, data)
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerBridgeTools(tools: ToolRegistry): void {
  tools.register({
    name: 'chat.send',
    description: 'Send a message to the chat surface',
    inputSchema: objectSchema({
      message: { type: 'string' },
      sessionId: { type: 'string' },
    }, ['message']),
    execute: async (params) => {
      const message = params.message
      if (typeof message !== 'string' || message.length === 0) {
        throw new Error('Missing required parameter: message')
      }
      sendToRenderer('bridge:chat:send', {
        message,
        sessionId: params.sessionId as string | undefined
      })
      return { sent: true }
    }
  })

  tools.register({
    name: 'editor.open',
    description: 'Open a file in the editor surface',
    inputSchema: objectSchema({
      path: { type: 'string' },
    }, ['path']),
    execute: async (params) => {
      const path = params.path
      if (typeof path !== 'string' || path.length === 0) {
        throw new Error('Missing required parameter: path')
      }
      sendToRenderer('bridge:editor:open', { path })
      return { opened: path }
    }
  })

  tools.register({
    name: 'terminal.run',
    description: 'Run a command in the terminal surface',
    inputSchema: objectSchema({
      command: { type: 'string' },
    }, ['command']),
    execute: async (params) => {
      const command = params.command
      if (typeof command !== 'string' || command.length === 0) {
        throw new Error('Missing required parameter: command')
      }
      sendToRenderer('bridge:terminal:run', { command })
      return { sent: true }
    }
  })

  tools.register({
    name: 'workbench.openWork',
    description: 'Open a package view or run in the Work pane',
    execute: async (params, ctx) => {
      const packageId = resolvePackageId(params, ctx)
      const kind = optionalString(params.kind) ?? 'package-view'

      if (kind === 'package-run') {
        const runId = requiredString(params.runId, 'runId')
        sendToRenderer('bridge:workbench:open-work', {
          kind,
          packageId,
          runId,
        })
        return { opened: true, pane: 'work', kind, packageId, runId }
      }

      if (kind !== 'package-view') throw new Error(`Unsupported Work target: ${kind}`)

      const viewId = optionalString(params.viewId)
      sendToRenderer('bridge:workbench:open-work', {
        kind,
        packageId,
        viewId,
      })
      return { opened: true, pane: 'work', kind, packageId, viewId }
    }
  })

  tools.register({
    name: 'workbench.openArtifact',
    description: 'Open a package view in the Artifact pane',
    execute: async (params, ctx) => {
      const packageId = resolvePackageId(params, ctx)
      const viewId = optionalString(params.viewId)
      sendToRenderer('bridge:workbench:open-artifact', {
        kind: 'package-view',
        packageId,
        viewId,
      })
      return { opened: true, pane: 'artifact', packageId, viewId }
    }
  })
}

function resolvePackageId(params: Record<string, unknown>, ctx: Parameters<ToolRegistry['call']>[2]): string {
  const requested = optionalString(params.packageId)
  if (ctx.actor === 'package') {
    if (!ctx.package_id) throw new Error('Package identity required')
    if (requested && requested !== ctx.package_id) {
      throw new Error('Package cannot open another package view')
    }
    return ctx.package_id
  }

  if (!requested) throw new Error('Missing required parameter: packageId')
  return requested
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error(`Missing required parameter: ${name}`)
}
