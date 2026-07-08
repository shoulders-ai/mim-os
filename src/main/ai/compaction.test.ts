import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_COMPACTION_NOTE } from './messageCompaction.js'
import { buildModelContext, estimateMessagesTokens, selectCompactionCut } from './compaction.js'

function browserOpenPart(id: number, observation = 'content') {
  return {
    type: 'tool-browser_open',
    toolCallId: `call_${id}`,
    state: 'output-available',
    input: { url: `https://example.com/${id}` },
    output: {
      url: `https://example.com/${id}`,
      title: `Page ${id}`,
      observation,
      refs: [{ ref: '1', kind: 'link', label: `Link ${id}` }],
      ref_count: 1,
      content_length: observation.length,
    },
  }
}

function bulkyText(label: string) {
  return [
    `${label}:head`,
    'a'.repeat(9_000),
    `${label}:middle`,
    'z'.repeat(9_000),
    `${label}:tail`,
  ].join('\n')
}

describe('buildModelContext', () => {
  it('injects the latest compaction summary and keeps only the recorded tail', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'old request' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'old answer' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'current request' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'current answer' }] },
    ] as any
    const result = buildModelContext({
      messages,
      compactions: [
        {
          id: 'cmp_old',
          firstKeptMessageId: 'u1',
          firstKeptMessageIndex: 0,
          summary: 'Older obsolete summary.',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'cmp_new',
          firstKeptMessageId: 'u2',
          firstKeptMessageIndex: 2,
          summary: 'Earlier work: chose the current plan.',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })

    expect(result.appliedCompactionId).toBe('cmp_new')
    expect(result.messages.map(message => message.id)).toEqual([
      'context_compaction_cmp_new',
      'u2',
      'a2',
    ])
    expect(result.messages[0].role).toBe('assistant')
    expect(result.messages[0].parts?.[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Earlier work: chose the current plan.'),
    })
    expect(JSON.stringify(result.messages)).not.toContain('old request')
    expect(messages).toHaveLength(4)
  })

  it('repairs incomplete assistant tool calls in the model view without mutating stored messages', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'read bbc' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I will read it.' },
          { type: 'tool-web_read', toolCallId: 'toolu_pending', state: 'input-available', input: { url: 'https://www.bbc.com/news' } },
        ],
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          { type: 'tool-web_read', toolCallId: 'toolu_hanging', state: 'input-streaming', input: { url: 'https://example.com' } },
        ],
      },
    ] as any

    const result = buildModelContext({ messages })

    expect(result.messages).toEqual([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'read bbc' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'I will read it.' }],
      },
    ])
    expect(messages[1].parts).toHaveLength(2)
    expect(messages[2].parts).toHaveLength(2)
  })

  it('compacts old browser observations in the model view without mutating stored messages', () => {
    const largeObservation = 'browser content '.repeat(8_000)
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [
        browserOpenPart(1, largeObservation),
        browserOpenPart(2, largeObservation),
        browserOpenPart(3, largeObservation),
        browserOpenPart(4, largeObservation),
      ],
    }] as any

    const result = buildModelContext({ messages })

    const parts = result.messages[0].parts
    expect(parts[0].output.observation).toBe(BROWSER_TOOL_COMPACTION_NOTE)
    expect(parts[1].output.observation).toBe(BROWSER_TOOL_COMPACTION_NOTE)
    expect(parts[2].output.observation).toContain('browser content')
    expect(parts[3].output.observation).toContain('browser content')
    expect(messages[0].parts[0].output.observation).toContain('browser content')
    expect(messages[0].parts[1].output.observation).toContain('browser content')
    expect(result.estimatedTokens).toBeLessThan(estimateMessagesTokens(messages))
  })

  it('compacts old web.read content while preserving recent reads and metadata', () => {
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [1, 2, 3].map((id) => {
        const content = bulkyText(`web-${id}`)

        return {
          type: 'tool-web_read',
          toolCallId: `web_${id}`,
          state: 'output-available',
          input: { url: `https://example.com/${id}` },
          output: {
            url: `https://example.com/${id}`,
            final_url: `https://example.com/${id}`,
            title: `Page ${id}`,
            content,
            content_length: content.length,
            source: 'rendered',
            elapsed_ms: 123,
            truncated: true,
            next_start_char: 5000,
          },
        }
      }),
    }] as any

    const result = buildModelContext({ messages })
    const parts = result.messages[0].parts

    expect(parts[0].output.content).toContain('web-1:head')
    expect(parts[0].output.content).toContain('web-1:tail')
    expect(parts[0].output.content).not.toContain('web-1:middle')
    expect(parts[0].output.content_compacted.original_chars).toBe(messages[0].parts[0].output.content.length)
    expect(parts[0].output.url).toBe('https://example.com/1')
    expect(parts[0].output.title).toBe('Page 1')
    expect(parts[0].output.truncated).toBe(true)
    expect(parts[0].output.next_start_char).toBe(5000)
    expect(parts[1].output.content).toBe(messages[0].parts[1].output.content)
    expect(parts[2].output.content).toBe(messages[0].parts[2].output.content)
    expect(messages[0].parts[0].output.content).toContain('web-1:middle')
    expect(result.estimatedTokens).toBeLessThan(estimateMessagesTokens(messages))
  })

  it('collapses repeated old tool outputs to a duplicate reference', () => {
    const duplicateContent = bulkyText('duplicate')
    const duplicateOutput = {
      url: 'https://example.com/duplicate',
      final_url: 'https://example.com/duplicate',
      title: 'Duplicate',
      content: duplicateContent,
      content_length: duplicateContent.length,
      source: 'rendered',
      elapsed_ms: 123,
    }
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-web_read',
          toolCallId: 'web_1',
          state: 'output-available',
          input: { url: 'https://example.com/duplicate' },
          output: duplicateOutput,
        },
        {
          type: 'tool-web_read',
          toolCallId: 'web_2',
          state: 'output-available',
          input: { url: 'https://example.com/duplicate' },
          output: { ...duplicateOutput },
        },
        {
          type: 'tool-web_read',
          toolCallId: 'web_3',
          state: 'output-available',
          input: { url: 'https://example.com/recent-1' },
          output: { ...duplicateOutput, url: 'https://example.com/recent-1', final_url: 'https://example.com/recent-1' },
        },
        {
          type: 'tool-web_read',
          toolCallId: 'web_4',
          state: 'output-available',
          input: { url: 'https://example.com/recent-2' },
          output: { ...duplicateOutput, url: 'https://example.com/recent-2', final_url: 'https://example.com/recent-2' },
        },
      ],
    }] as any

    const result = buildModelContext({ messages })
    const duplicateReference = result.messages[0].parts[1].output

    expect(result.messages[0].parts[0].output.content).toContain('duplicate:head')
    expect(duplicateReference.compacted_reason).toBe('duplicate_tool_result')
    expect(duplicateReference.duplicate_of_tool_call_id).toBe('web_1')
    expect(duplicateReference.tool_key).toBe('web_read')
    expect(result.messages[0].parts[2].output.content).toBe(messages[0].parts[2].output.content)
    expect(result.messages[0].parts[3].output.content).toBe(messages[0].parts[3].output.content)
    expect(messages[0].parts[1].output.content).toContain('duplicate:middle')
  })

  it('compacts old fs.read content while preserving path, line, and version metadata', () => {
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [1, 2, 3].map((id) => {
        const content = bulkyText(`file-${id}`)

        return {
          type: 'tool-fs_read',
          toolCallId: `read_${id}`,
          state: 'output-available',
          input: { path: `src/file-${id}.ts` },
          output: {
            path: `src/file-${id}.ts`,
            content,
            total_lines: 900,
            start_line: 1,
            end_line: 900,
            total_chars: content.length,
            version: { hash: `hash-${id}` },
            truncated: true,
          },
        }
      }),
    }] as any

    const result = buildModelContext({ messages })
    const firstOutput = result.messages[0].parts[0].output

    expect(firstOutput.content).toContain('file-1:head')
    expect(firstOutput.content).toContain('file-1:tail')
    expect(firstOutput.content).not.toContain('file-1:middle')
    expect(firstOutput.content_compacted.original_chars).toBe(messages[0].parts[0].output.content.length)
    expect(firstOutput.path).toBe('src/file-1.ts')
    expect(firstOutput.start_line).toBe(1)
    expect(firstOutput.end_line).toBe(900)
    expect(firstOutput.version).toEqual({ hash: 'hash-1' })
    expect(result.messages[0].parts[1].output.content).toBe(messages[0].parts[1].output.content)
    expect(result.messages[0].parts[2].output.content).toBe(messages[0].parts[2].output.content)
    expect(messages[0].parts[0].output.content).toContain('file-1:middle')
  })

  it('compacts old shell output while preserving status and diagnostic tails', () => {
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [1, 2, 3].map((id) => {
        const stdout = bulkyText(`stdout-${id}`)
        const stderr = `${bulkyText(`stderr-${id}`)}\nfinal diagnostic ${id}`

        return {
          type: 'tool-bash',
          toolCallId: `bash_${id}`,
          state: 'output-available',
          input: { cmd: `npm run task:${id}` },
          output: {
            exitCode: id === 1 ? 1 : 0,
            timedOut: false,
            durationMs: 1000,
            stdout,
            stderr,
            products: [{ path: `out-${id}.json`, mime: 'application/json' }],
            runId: `run-${id}`,
            runDir: `.mim/code-runs/run-${id}`,
          },
        }
      }),
    }] as any

    const result = buildModelContext({ messages })
    const firstOutput = result.messages[0].parts[0].output

    expect(firstOutput.exitCode).toBe(1)
    expect(firstOutput.products).toEqual([{ path: 'out-1.json', mime: 'application/json' }])
    expect(firstOutput.runId).toBe('run-1')
    expect(firstOutput.stdout).toContain('stdout-1:head')
    expect(firstOutput.stdout).toContain('stdout-1:tail')
    expect(firstOutput.stdout).not.toContain('stdout-1:middle')
    expect(firstOutput.stderr).toContain('stderr-1:head')
    expect(firstOutput.stderr).toContain('final diagnostic 1')
    expect(firstOutput.stderr).not.toContain('stderr-1:middle')
    expect(result.messages[0].parts[1].output.stdout).toBe(messages[0].parts[1].output.stdout)
    expect(result.messages[0].parts[2].output.stdout).toBe(messages[0].parts[2].output.stdout)
    expect(messages[0].parts[0].output.stderr).toContain('stderr-1:middle')
  })

  it('compacts oversized tool arguments in the model view without touching output', () => {
    const content = bulkyText('write')
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [{
        type: 'tool-fs_write',
        toolCallId: 'write_1',
        state: 'output-available',
        input: { path: 'draft.md', content },
        output: { path: 'draft.md', bytes: content.length, hash: 'abc123' },
      }],
    }] as any

    const result = buildModelContext({ messages })
    const part = result.messages[0].parts[0]

    expect(part.input.path).toBe('draft.md')
    expect(part.input.content).toContain('write:head')
    expect(part.input.content).toContain('write:tail')
    expect(part.input.content).not.toContain('write:middle')
    expect(part.input.content_compacted.original_chars).toBe(content.length)
    expect(part.output).toEqual({ path: 'draft.md', bytes: content.length, hash: 'abc123' })
    expect(messages[0].parts[0].input.content).toBe(content)
  })

  it('compacts old dynamic package tool payloads without losing identity fields', () => {
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: [1, 2, 3].map((id) => ({
        type: 'dynamic-tool',
        toolName: 'package.lookup',
        toolCallId: `package_${id}`,
        state: 'output-available',
        input: { query: `item ${id}` },
        output: {
          id: `item-${id}`,
          status: 'ok',
          url: `https://example.com/item/${id}`,
          body: bulkyText(`package-${id}`),
        },
      })),
    }] as any

    const result = buildModelContext({ messages })
    const firstOutput = result.messages[0].parts[0].output

    expect(firstOutput.id).toBe('item-1')
    expect(firstOutput.status).toBe('ok')
    expect(firstOutput.url).toBe('https://example.com/item/1')
    expect(firstOutput.body).toContain('package-1:head')
    expect(firstOutput.body).toContain('package-1:tail')
    expect(firstOutput.body).not.toContain('package-1:middle')
    expect(firstOutput.body_compacted.original_chars).toBe(messages[0].parts[0].output.body.length)
    expect(result.messages[0].parts[1].output.body).toBe(messages[0].parts[1].output.body)
    expect(result.messages[0].parts[2].output.body).toBe(messages[0].parts[2].output.body)
  })
})

describe('selectCompactionCut', () => {
  it('keeps a recent tail at a user boundary and always includes the last user message', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'start' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'old '.repeat(600) }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'middle request' }] },
      { id: 'a2', role: 'assistant', parts: [{ type: 'text', text: 'middle '.repeat(600) }] },
      { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'latest request' }] },
      { id: 'a3', role: 'assistant', parts: [{ type: 'text', text: 'latest answer' }] },
    ] as any

    const cut = selectCompactionCut({ messages, modelWindow: 4000, tailTargetTokens: 200 })

    expect(cut).toMatchObject({
      firstKeptMessageId: 'u3',
      firstKeptMessageIndex: 4,
      summarizedMessageCount: 4,
    })
    expect(cut?.summarizedMessages.map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(cut?.keptMessages.map(message => message.id)).toEqual(['u3', 'a3'])
  })
})
