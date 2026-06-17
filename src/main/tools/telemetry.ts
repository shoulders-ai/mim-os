import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import { sanitizeTelemetryEvent } from '@main/telemetry/events.js'
import type { TelemetryClient } from '@main/telemetry/telemetry.js'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerTelemetryTools(tools: ToolRegistry, telemetry: TelemetryClient): void {
  tools.register({
    name: 'telemetry.track',
    description: 'Record an allowlisted anonymous usage telemetry event.',
    inputSchema: objectSchema({
      event: { type: 'string' },
      props: { type: 'object' },
    }, ['event']),
    execute: async (params, ctx) => {
      assertUserOrSystem(ctx)
      const normalized = sanitizeTelemetryEvent(params.event, params.props)
      if (!normalized) throw new Error('Unknown telemetry event')
      telemetry.track(normalized.eventType, normalized.props)
      return {
        tracked: true,
        event: normalized.eventType,
        props: normalized.props,
      }
    },
  })

  tools.register({
    name: 'telemetry.status',
    description: 'Read anonymous telemetry enabled state. Does not return the anonymous id.',
    inputSchema: objectSchema({}),
    execute: async (_params, ctx) => {
      assertUserOrSystem(ctx)
      const status = telemetry.status()
      return {
        enabled: status.enabled,
        locked: status.locked,
      }
    },
  })

  tools.register({
    name: 'telemetry.setEnabled',
    description: 'Enable or disable anonymous usage telemetry for this machine.',
    inputSchema: objectSchema({
      enabled: { type: 'boolean' },
    }, ['enabled']),
    execute: async (params, ctx) => {
      assertUserOrSystem(ctx)
      if (typeof params.enabled !== 'boolean') throw new Error('enabled must be a boolean')
      const status = telemetry.setEnabled(params.enabled)
      return {
        enabled: status.enabled,
        locked: status.locked,
      }
    },
  })
}

function assertUserOrSystem(ctx: ToolContext): void {
  if (ctx.actor === 'user' || ctx.actor === 'system') return
  throw new Error('Telemetry tools are user-only')
}
