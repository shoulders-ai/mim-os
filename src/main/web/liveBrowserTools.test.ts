import { describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerWebTools } from '@main/tools/web.js'

describe('live browser web tools', () => {
  it('registers Markanywhere-style live browser tools separately from simple web.read', async () => {
    const tools = createToolRegistry(createTraceLog())
    registerWebTools(tools)

    expect(tools.get('web.live.open')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string' },
        stateful: { type: 'boolean' },
        visible: { type: 'boolean' },
        max_chars: { type: 'number' },
        start_from_char: { type: 'number' },
      },
    })
    expect(tools.get('web.live.act')?.inputSchema).toMatchObject({
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string' },
        max_chars: { type: 'number' },
        start_from_char: { type: 'number' },
      },
    })
    expect(tools.get('web.live.observe')).toBeUndefined()
    expect(tools.get('web.live.click')).toBeUndefined()
    expect(tools.get('web.live.type')).toBeUndefined()
    expect(tools.get('web.live.scroll')).toBeUndefined()
    expect(tools.get('web.live.wait')).toBeUndefined()
    expect(tools.get('web.live.extract')).toBeUndefined()
    expect(tools.get('web.live.close')).toBeUndefined()
  })

  it('routes live browser calls through the injected session driver with chat session context', async () => {
    const tools = createToolRegistry(createTraceLog())
    const liveBrowser = {
      open: vi.fn(async () => ({ observation: 'Page', refs: [] })),
      observe: vi.fn(async () => ({ observation: 'Observed', refs: [] })),
      click: vi.fn(async () => ({ changed: true, observe_next: true })),
      type: vi.fn(async () => ({ changed: true, observe_next: true })),
      scroll: vi.fn(async () => ({ changed: true, observe_next: true })),
      wait: vi.fn(async () => ({ waited_ms: 250, observe_next: true })),
      extract: vi.fn(async () => ({ content: 'Extracted', content_length: 9 })),
      show: vi.fn(async () => ({ visible: true })),
      hide: vi.fn(async () => ({ visible: false })),
      close: vi.fn(async () => ({ closed: true })),
    }
    registerWebTools(tools, { liveBrowser })
    const ctx = { actor: 'ai' as const, sessionId: 's1' }

    await tools.call('web.live.open', {
      url: 'https://example.com',
      stateful: false,
      visible: true,
      max_chars: 2000,
      start_from_char: 20,
    }, ctx)
    await tools.call('web.live.act', { action: 'observe', max_chars: 1500, start_from_char: 30 }, ctx)
    await tools.call('web.live.act', { action: 'click', ref: '1', max_chars: 1200 }, ctx)
    await tools.call('web.live.act', { action: 'type', ref: '2', text: 'Alice', wait_ms: 300 }, ctx)
    await tools.call('web.live.act', { action: 'scroll', direction: 'down', amount: 400 }, ctx)
    await tools.call('web.live.act', { action: 'wait', ms: 250 }, ctx)
    await tools.call('web.live.act', { action: 'extract', max_chars: 1000, start_from_char: 40 }, ctx)
    await tools.call('web.live.act', { action: 'show' }, ctx)
    await tools.call('web.live.act', { action: 'hide' }, ctx)
    await tools.call('web.live.act', { action: 'close' }, ctx)

    expect(liveBrowser.open).toHaveBeenCalledWith(
      { url: 'https://example.com', stateful: false, visible: true, timeout_ms: undefined, max_chars: 2000, start_from_char: 20 },
      expect.objectContaining(ctx),
    )
    expect(liveBrowser.observe).toHaveBeenCalledWith({ max_chars: 1500, start_from_char: 30 }, expect.objectContaining(ctx))
    expect(liveBrowser.click).toHaveBeenCalledWith({ ref: '1' }, expect.objectContaining(ctx))
    expect(liveBrowser.type).toHaveBeenCalledWith({ ref: '2', text: 'Alice' }, expect.objectContaining(ctx))
    expect(liveBrowser.wait).toHaveBeenCalledWith({ ms: 300 }, expect.objectContaining(ctx))
    expect(liveBrowser.extract).toHaveBeenCalledWith({ max_chars: 1000, start_from_char: 40 }, expect.objectContaining(ctx))
    expect(liveBrowser.show).toHaveBeenCalledWith({}, expect.objectContaining(ctx))
    expect(liveBrowser.hide).toHaveBeenCalledWith({}, expect.objectContaining(ctx))
    expect(liveBrowser.close).toHaveBeenCalledWith({}, expect.objectContaining(ctx))
  })

  it('reports live browser as unavailable without a desktop driver', async () => {
    const tools = createToolRegistry(createTraceLog())
    registerWebTools(tools)

    await expect(tools.call('web.live.act', { action: 'observe' }, { actor: 'ai', sessionId: 's1' }))
      .rejects.toThrow('Live browser is only available in the Electron desktop runtime')
  })
})
