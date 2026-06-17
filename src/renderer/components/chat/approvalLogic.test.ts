import { describe, expect, it } from 'vitest'
import {
  actionPhrase,
  approvalNote,
  approvalQuestion,
  approvalTone,
  canRemember,
  canReviewChange,
  detailRows,
  rememberLabel,
  targetDetail,
  targetDisplay,
  targetIsCommand,
} from './approvalLogic.js'

describe('approval logic', () => {
  it('phrases actions in plain language a non-engineer understands', () => {
    expect(approvalQuestion({ toolName: 'fs.edit', category: 'write' })).toBe('Allow Mim to edit a file?')
    expect(approvalQuestion({ toolName: 'terminal.run', category: 'system' })).toBe('Allow Mim to run a terminal command?')
    expect(approvalQuestion({ toolName: 'fs.delete', category: 'write' })).toBe('Allow Mim to delete a file?')
  })

  it('falls back to the category, then a readable tool name', () => {
    expect(actionPhrase({ toolName: 'some.future.tool', category: 'network' })).toBe('contact an outside service')
    expect(actionPhrase({ toolName: 'mystery_tool' })).toBe('use mystery.tool')
  })

  it('prefers label over category, but ACTION_PHRASES always win', () => {
    // ACTION_PHRASES wins over label
    expect(actionPhrase({ toolName: 'fs.delete', label: 'Board: Delete issue', category: 'write' }))
      .toBe('delete a file')
    // label wins over category
    expect(actionPhrase({ toolName: 'board.deleteIssue', label: 'Board: Delete issue', category: 'write' }))
      .toBe('use Board: Delete issue')
    // label wins over formatToolName fallback
    expect(actionPhrase({ toolName: 'board.deleteIssue', label: 'Board: Delete issue' }))
      .toBe('use Board: Delete issue')
    // no label, no category → formatToolName
    expect(actionPhrase({ toolName: 'board.deleteIssue' })).toBe('use board.deleteIssue')
    // no label, has category → category phrase
    expect(actionPhrase({ toolName: 'board.deleteIssue', category: 'write' })).toBe('change a file')
  })

  it('shows the one concrete thing to verify: a path or a command', () => {
    expect(targetDisplay({ toolName: 'fs.edit', params: { path: 'notes/plan.md' }, target: '/abs/notes/plan.md' }))
      .toBe('notes/plan.md')
    expect(targetDisplay({ toolName: 'terminal.run', params: { command: 'rm -rf build' } }))
      .toBe('rm -rf build')
    expect(targetDisplay({ toolName: 'fs.rename', params: { old_path: 'a.md', new_path: 'b.md' } }))
      .toBe('a.md → b.md')
  })

  it('renders commands as wrapping blocks, paths as single lines', () => {
    expect(targetIsCommand({ toolName: 'terminal.run' })).toBe(true)
    expect(targetIsCommand({ toolName: 'fs.edit' })).toBe(false)
  })

  it('keeps routine edits calm and sets irreversible actions apart', () => {
    expect(approvalTone({ toolName: 'fs.edit', risk: 'medium' })).toBe('normal')
    expect(approvalTone({ toolName: 'fs.delete', risk: 'high' })).toBe('caution')
    expect(approvalTone({ toolName: 'fs.write', risk: 'medium', pathKind: 'sensitive' })).toBe('caution')
    expect(approvalTone({ toolName: 'fs.write', risk: 'medium', pathKind: 'outside-workspace' })).toBe('caution')
  })

  it('only flags a note when the target itself is unusual', () => {
    expect(approvalNote({ toolName: 'fs.write', pathKind: 'workspace' })).toBe('')
    expect(approvalNote({ toolName: 'fs.write', pathKind: 'sensitive' })).toContain('sensitive')
    expect(approvalNote({ toolName: 'fs.write', pathKind: 'outside-workspace' })).toContain('outside your workspace')
    expect(approvalNote({ toolName: 'fs.write', pathKind: 'resource', resourceCollectionId: 'designs' }))
      .toContain('shared resource "designs"')
    expect(approvalNote({ toolName: 'fs.write', pathKind: 'resource' })).toContain('shared resource collection')
  })

  it('offers review only for changes that have a before/after', () => {
    expect(canReviewChange({ toolName: 'fs.edit', preview: { kind: 'edit' } })).toBe(true)
    expect(canReviewChange({ toolName: 'terminal.run' })).toBe(false)
  })

  it('offers a remember control only when scoped to a conversation', () => {
    expect(canRemember({ toolName: 'fs.edit', sessionId: 's1' })).toBe(true)
    expect(canRemember({ toolName: 'fs.edit' })).toBe(false)
    expect(rememberLabel({ toolName: 'fs.edit', category: 'write' })).toBe('Always allow file changes in this chat')
    expect(rememberLabel({ toolName: 'terminal.run' })).toBe('Always allow terminal commands in this chat')
  })

  it('previews the payload of outbound sends, nothing for others', () => {
    expect(targetDetail({ toolName: 'slack.send', params: { channel: '#pricing', text: 'Q3 numbers are in' } }))
      .toBe('Q3 numbers are in')
    expect(targetDetail({ toolName: 'gmail.send', params: { to: 'a@b.com', subject: 'Hi', body: 'See attached' } }))
      .toBe('Hi — See attached')
    expect(targetDetail({ toolName: 'calendar.create', params: { summary: 'Kickoff', start: 'Tue 3pm', end: 'Tue 4pm' } }))
      .toBe('Tue 3pm → Tue 4pm')
    expect(targetDetail({ toolName: 'fs.edit', params: { path: 'a.md' } })).toBe('')
  })

  it('exposes the exact call as detail rows, already redacted, skipping empties', () => {
    expect(detailRows({ toolName: 'fs.write', params: { path: 'a.md', content: '[redacted]', expected_hash: null } }))
      .toEqual([
        { key: 'path', value: 'a.md' },
        { key: 'content', value: '[redacted]' },
      ])
  })
})
