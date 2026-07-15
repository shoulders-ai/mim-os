import type { SubagentManager } from '@main/subagents/subagentManager.js'
import type { ToolContext, ToolRegistry } from './registry.js'

const string = { type: 'string' } as const
const stringArray = { type: 'array', items: string } as const

export function registerSubagentTools(tools: ToolRegistry, manager: SubagentManager): void {
  register('subagent.spawn', 'Create a durable child agent thread and return immediately', {
    type: 'object',
    properties: {
      prompt: string,
      label: string,
      model: string,
      agent: string,
      skills: stringArray,
      tools: stringArray,
      context: stringArray,
      requestedGrants: stringArray,
    },
    required: ['prompt'],
  }, (params, ctx) => manager.spawn(params as any, ctx))

  register('subagent.wait', 'Wait for child state changes without limiting child runtime', {
    type: 'object',
    properties: {
      sessionIds: stringArray,
      until: { type: 'string', enum: ['any', 'all'] },
      timeoutMs: { type: 'number', minimum: 0, maximum: 240000 },
    },
    required: ['sessionIds'],
  }, (params, ctx) => manager.wait(params as any, ctx))

  register('subagent.send', 'Steer a running child or start a contextual follow-up turn', {
    type: 'object',
    properties: { sessionId: string, message: string },
    required: ['sessionId', 'message'],
  }, (params, ctx) => manager.send(params as any, ctx))

  register('subagent.interrupt', 'Interrupt the active child turn and optionally redirect it', {
    type: 'object',
    properties: { sessionId: string, message: string },
    required: ['sessionId'],
  }, (params, ctx) => manager.interrupt(params as any, ctx))

  register('subagent.stop', 'Stop automatic child work while retaining its transcript', {
    type: 'object',
    properties: { sessionId: string },
    required: ['sessionId'],
  }, (params, ctx) => manager.stop(params as any, ctx))

  register('subagent.status', 'Read one child thread status and result summary', {
    type: 'object',
    properties: { sessionId: string },
    required: ['sessionId'],
  }, (params, ctx) => manager.status(params as any, ctx))

  register('subagent.list', 'List child threads in this task lineage', {
    type: 'object',
    properties: {},
  }, (params, ctx) => manager.list(params as Record<string, never>, ctx))

  register('subagent.result', 'Read a child final response by character page', {
    type: 'object',
    properties: {
      sessionId: string,
      offset: { type: 'number', minimum: 0 },
      maxChars: { type: 'number', minimum: 1, maximum: 100000 },
    },
    required: ['sessionId'],
  }, (params, ctx) => manager.result(params as any, ctx))

  function register(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>,
  ): void {
    tools.register({
      name,
      description,
      inputSchema,
      async execute(params, ctx) {
        if (ctx.actor === 'package') throw new Error('Apps cannot create or control subagents')
        return execute(params, ctx)
      },
    })
  }
}
