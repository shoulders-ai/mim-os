import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanTaskLabel,
  isPlaceholderTaskLabel,
  provisionalTaskLabel,
  requestTaskLabel,
  shouldRequestTaskLabel,
  taskLabelContextLabels,
} from './taskLabel.js'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('task label helpers', () => {
  it('recognizes placeholder labels used before a generated task label exists', () => {
    expect(isPlaceholderTaskLabel('Chat 2')).toBe(true)
    expect(isPlaceholderTaskLabel('Task 7')).toBe(true)
    expect(isPlaceholderTaskLabel('New chat')).toBe(true)
    expect(isPlaceholderTaskLabel('New task')).toBe(true)
    expect(isPlaceholderTaskLabel('Review manuscript comments')).toBe(false)
  })

  it('only requests task labels for empty placeholder sessions', () => {
    expect(shouldRequestTaskLabel({ label: 'Chat 2' }, 0)).toBe(true)
    expect(shouldRequestTaskLabel({ label: 'Chat 2', taskLabelGenerated: true }, 0)).toBe(false)
    expect(shouldRequestTaskLabel({ label: 'Chat 2' }, 1)).toBe(false)
    expect(shouldRequestTaskLabel({ label: 'Draft donor update' }, 0)).toBe(false)
  })

  it('collects compact context labels from attachments and composer chips', () => {
    expect(taskLabelContextLabels(
      [{ filename: 'quotes.xlsx' }, { filename: 'quotes.xlsx' }],
      [{ label: 'Finance agenda' }, { path: 'docs/report.docx' }, { id: 'current-document' }],
    )).toEqual(['quotes.xlsx', 'Finance agenda', 'docs/report.docx', 'current-document'])
  })

  it('cleans labels returned by the endpoint', () => {
    expect(cleanTaskLabel(' "Compare supplier quotes." ')).toBe('Compare supplier quotes')
    expect(cleanTaskLabel('Task: Compare supplier quotes')).toBe('Compare supplier quotes')
    expect(cleanTaskLabel('Task: "Compare supplier quotes"')).toBe('Compare supplier quotes')
    expect(cleanTaskLabel('Task')).toBe('')
    expect(cleanTaskLabel('one two three four five six')).toBe('one two three four')
    expect(cleanTaskLabel('A'.repeat(80))).toHaveLength(40)
  })

  it('creates short provisional labels without waiting for a model', () => {
    expect(provisionalTaskLabel('what are different weather apis we could use?')).toBe('Weather API options')
    expect(provisionalTaskLabel('please review the board deck before tomorrow')).toBe('Review board deck')
    expect(provisionalTaskLabel('summarize this', ['interview_notes.docx'])).toBe('Summarize interview notes')
  })

  it('requests a task label from the local AI endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ label: ' Compare supplier quotes. ' }),
    })

    const label = await requestTaskLabel('http://127.0.0.1:17654', {
      userText: 'Compare the quotes before the finance meeting',
      contextLabels: ['quotes.xlsx', 'quotes.xlsx'],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:17654/api/ai/task-label',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: 'Compare the quotes before the finance meeting',
          contextLabels: ['quotes.xlsx'],
        }),
      }),
    )
    expect(label).toBe('Compare supplier quotes')
  })
})
